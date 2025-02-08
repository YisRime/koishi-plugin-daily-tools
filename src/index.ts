import { Context, Schema } from 'koishi'
import * as cron from 'koishi-plugin-cron'

export const name = 'daily-tools'
export const inject = {
  required: ['database'],
  optional: ['cron']
}

// 定义不同的随机数生成算法，用于计算今日人品值
export const enum JrrpAlgorithm {
  BASIC = 'basic',      // 基础哈希算法: 使用简单的哈希取模运算
  GAUSSIAN = 'gaussian', // 高斯分布算法: 生成近似正态分布的随机数
  LINEAR = 'linear'     // 线性同余算法: 使用线性同余方法生成伪随机数
}

// 定义不同的睡眠时长计算方式
export const enum SleepMode {
  STATIC = 'static',  // 静态模式: 固定时长
  UNTIL = 'until',    // 定时模式: 睡到指定时间
  RANDOM = 'random'   // 随机模式: 在指定范围内随机时长
}

// 修改配置接口定义
export interface Config {
  sleep: {
    type: SleepMode
    duration: number
    until: string
    min: number
    max: number
  }
  autoLikeList?: string[]
  autoLikeTime?: string
  notifyAccount?: string
  choice?: JrrpAlgorithm
  specialMessages?: Record<number, string>
  rangeMessages?: Record<string, string>
  holidayMessages?: Record<string, string>
}

// 更新配置模式定义
export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    sleep: Schema.object({
      type: Schema.union([
        Schema.const(SleepMode.STATIC),
        Schema.const(SleepMode.UNTIL),
        Schema.const(SleepMode.RANDOM),
      ]).default(SleepMode.STATIC),
      duration: Schema.number().default(480),
      until: Schema.string().default('08:00'),
      min: Schema.number().default(360),
      max: Schema.number().default(600),
    }),
  }).i18n({
    'zh-CN': require('./locales/zh-CN').sleepconfig,
    'en-US': require('./locales/en-US').sleepconfig,
  }),

  Schema.object({
    autoLikeList: Schema.array(String),
    autoLikeTime: Schema.string(),
    notifyAccount: Schema.string(),
  }).i18n({
    'zh-CN': require('./locales/zh-CN').autolikeconfig,
    'en-US': require('./locales/en-US').autolikeconfig,
  }),

  Schema.object({
    choice: Schema.union([
      Schema.const(JrrpAlgorithm.BASIC),
      Schema.const(JrrpAlgorithm.GAUSSIAN),
      Schema.const(JrrpAlgorithm.LINEAR),
    ]).default(JrrpAlgorithm.BASIC),
    rangeMessages: Schema.dict(String).default({
      '0-9': 'jrrp.messages.range.1',
      '10-19': 'jrrp.messages.range.2',
      '20-39': 'jrrp.messages.range.3',
      '40-49': 'jrrp.messages.range.4',
      '50-69': 'jrrp.messages.range.5',
      '70-89': 'jrrp.messages.range.6',
      '90-95': 'jrrp.messages.range.7',
      '96-100': 'jrrp.messages.range.8'
    }),
    specialMessages: Schema.dict(String).default({
      0: 'jrrp.messages.special.1',
      50: 'jrrp.messages.special.2',
      100: 'jrrp.messages.special.3'
    }),
    holidayMessages: Schema.dict(String).default({
      '01-01': 'jrrp.messages.date.1',
      '12-25': 'jrrp.messages.date.2'
    })
  }).i18n({
    'zh-CN': require('./locales/zh-CN').jrrpconfig,
    'en-US': require('./locales/en-US').jrrpconfig,
  }),
])

export async function apply(ctx: Context, config: Config) {
  // 初始化多语言支持
  ctx.i18n.define('zh-CN', require('./locales/zh-CN'));
  ctx.i18n.define('en-US', require('./locales/en-US'));

  // 注册精致睡眠命令
  ctx.command('sleep')
    .alias('jzsm')
    .alias('精致睡眠')
    .action(async ({ session }) => {
      if (!session.guildId) {
        return session.text('commands.sleep.messages.guild_only')
      }

      let duration: number
      const now = new Date()
      const sleep = config.sleep

      switch (sleep.type) {
        case 'static':
          duration = Math.max(1, sleep.duration)
          break
        case 'until':
          const [hours, minutes] = sleep.until.split(':').map(Number)
          const endTime = new Date(now)
          endTime.setHours(hours, minutes, 0, 0)
          if (endTime <= now) {
            endTime.setDate(endTime.getDate() + 1)
          }
          duration = Math.max(1, Math.floor((endTime.getTime() - now.getTime()) / 60000))
          break
        case 'random':
          const min = Math.max(1, sleep.min)
          const max = Math.max(min, sleep.max)
          duration = Math.floor(Math.random() * (max - min + 1) + min)
          break
        default:
          return session.text('commands.sleep.messages.invalid_mode')
      }

      try {
        await session.bot.muteGuildMember(session.guildId, session.userId, duration * 60 * 1000)
        return session.text('commands.sleep.messages.success', [duration])
      } catch (error) {
        ctx.logger('sleep').warn(error)
        return session.text('commands.sleep.messages.failed')
      }
    })

  // 注册手动点赞命令
  ctx.command('zanwo')
    .alias('赞我')
    .action(async ({ session }) => {
      let successfulLikes = 0
      try {
        for (let i = 0; i < 5; i++) {
          await session.bot.internal.sendLike(session.userId, 10)
          successfulLikes += 1
        }
        return session.text('commands.zanwo.messages.success')
      } catch (_e) {
        if (successfulLikes > 0) return session.text('commands.zanwo.messages.success')
        return session.text('commands.zanwo.messages.failure')
      }
    })

  // 注册自动点赞功能
  if (config.autoLikeList?.length > 0 && config.autoLikeTime) {
    const [hour, minute] = config.autoLikeTime.split(':').map(Number)

    // 注册定时任务
    ctx.cron(`0 ${minute} ${hour} * * *`, async () => {
      const results = []

      for (const userId of config.autoLikeList) {
        try {
          // 每个用户尝试点赞5轮
          for (let i = 0; i < 5; i++) {
            await ctx.bots.first?.internal.sendLike(userId, 10)
          }
          results.push(`用户 ${userId} 点赞成功`)
        } catch (error) {
          results.push(`用户 ${userId} 点赞失败: ${error.message}`)
        }
      }

      // 如果配置了通知账户，发送点赞结果
      if (config.notifyAccount) {
        const resultMessage = results.join('\n')
        await ctx.bots.first?.sendPrivateMessage(config.notifyAccount, resultMessage)
      }
    })
  }

  // 注册今日人品命令
  ctx.command('jrrp')
    .option('d', '', { type: 'string' })
    .action(async ({ session, options }) => {
      // 处理 -d 选项，支持 "YYYY-MM-DD" 或 "MM-DD" 格式
      let targetDate = new Date();
      if (options?.d) {
        const dateStr = String(options.d);
        const fullDateMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (fullDateMatch) {
          targetDate = new Date(dateStr);
        } else {
          const parts = dateStr.split('-');
          if (parts.length === 2) {
            const month = Number(parts[0]);
            const day = Number(parts[1]);
            if (!isNaN(month) && !isNaN(day)) {
              const currentYear = targetDate.getFullYear();
              targetDate = new Date(currentYear, month - 1, day);
            }
          }
        }
      }
      // 使用 "YYYY-MM-DD" 格式
      const year = targetDate.getFullYear();
      const monthStr = String(targetDate.getMonth() + 1).padStart(2, '0');
      const dayStr = String(targetDate.getDate()).padStart(2, '0');
      const currentDateStr = `${year}-${monthStr}-${dayStr}`;
      const monthDay = `${monthStr}-${dayStr}`;

      //特殊日期处理流程
      if (config.holidayMessages?.[monthDay]) {
        await session.send(session.text(config.holidayMessages[monthDay] + 'commands.jrrp.messages.prompt'));
        const response = await session.prompt(10000);
        if (!response) {
          return session.text('commands.jrrp.messages.cancel');
        }
      }

      // 获取用户昵称
      const userNickname = session.username || 'User'

      // 将字符串转换为32位无符号整数
      function hashCode(str: string): number {
        let hash = 5381
        for (let i = 0; i < str.length; i++) {
          hash = ((hash << 5) + hash) + str.charCodeAt(i)
          hash = hash >>> 0 // 保持为32位无符号整数
        }
        return hash
      }

      let luckScore: number
      const userDateSeed = `${session.userId}-${currentDateStr}`

      // 根据选择的算法计算今日人品值
      switch (config.choice || 'basic') {
        case 'basic': {
          // 基础算法：直接取模
          const modLuck = Math.abs(hashCode(userDateSeed)) % 101
          luckScore = modLuck
          break
        }
        case 'gaussian': {
          // 正态分布算法
          function normalRandom(seed: string): number {
            const hash = hashCode(seed)
            const randomFactor = Math.sin(hash) * 10000
            return randomFactor - Math.floor(randomFactor)
          }
          function toNormalLuck(random: number): number {
            const u1 = random
            const u2 = normalRandom(random.toString())
            const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
            return Math.min(100, Math.max(0, Math.round(z * 15 + 50)))
          }
          const dateWeight = (targetDate.getDay() + 1) / 7
          const baseRandom = normalRandom(userDateSeed)
          const weightedRandom = (baseRandom + dateWeight) / 2
          const normalLuck = toNormalLuck(weightedRandom)
          luckScore = normalLuck
          break
        }
        case 'linear': {
          // 线性同余算法
          const lcgSeed = hashCode(userDateSeed)
          const lcgValue = (lcgSeed * 9301 + 49297) % 233280
          const lcgRandom = lcgValue / 233280
          const lcgLuck = Math.floor(lcgRandom * 101)
          luckScore = lcgLuck
          break
        }
        default: {
          // 默认使用基础算法
          luckScore = Math.abs(hashCode(userDateSeed)) % 101
        }
      }

      // 构建返回消息
      let message = session.text('commands.jrrp.messages.result', [luckScore, userNickname])
      if (config.specialMessages && luckScore in config.specialMessages) {   // 修改key为specialMessages
        message += session.text(config.specialMessages[luckScore])
      } else if (config.rangeMessages) {                  // 修改key为rangeMessages
        // 遍历所有范围配置
        for (const [range, msg] of Object.entries(config.rangeMessages)) {
          const [min, max] = range.split('-').map(Number)
          if (!isNaN(min) && !isNaN(max) && luckScore >= min && luckScore <= max) {
            message += session.text(msg)
            break
          }
        }
      }
      return message
    })
}

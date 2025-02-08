import { Context, Schema, Random } from 'koishi'
import {} from 'koishi-plugin-adapter-onebot'
import * as cron from 'koishi-plugin-cron'

export const name = 'daily-tools'
export const inject = {
  required: ['database'],
  optional: ['cron', 'adapter-onebot']
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

export const enum MuteDurationType {
  STATIC = 'static',  // 固定时长
  RANDOM = 'random'   // 随机时长
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
  mute: {
    type: MuteDurationType
    duration: number
    minDuration: number
    maxDuration: number
    probability: number
    enableMessage: boolean
    enableMuteOthers: boolean
  }
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
      '0-9': 'commands.jrrp.messages.range.1',
      '10-19': 'commands.jrrp.messages.range.2',
      '20-39': 'commands.jrrp.messages.range.3',
      '40-49': 'commands.jrrp.messages.range.4',
      '50-69': 'commands.jrrp.messages.range.5',
      '70-89': 'commands.jrrp.messages.range.6',
      '90-95': 'commands.jrrp.messages.range.7',
      '96-100': 'commands.jrrp.messages.range.8'
    }),
    specialMessages: Schema.dict(String).default({
      0: 'commands.jrrp.messages.special.1',
      50: 'commands.jrrp.messages.special.2',
      100: 'commands.jrrp.messages.special.3'
    }),
    holidayMessages: Schema.dict(String).default({
      '01-01': 'commands.jrrp.messages.date.1',
      '12-25': 'commands.jrrp.messages.date.2'
    })
  }).i18n({
    'zh-CN': require('./locales/zh-CN').jrrpconfig,
    'en-US': require('./locales/en-US').jrrpconfig,
  }),

  Schema.object({
    mute: Schema.object({
      type: Schema.union([
        Schema.const(MuteDurationType.STATIC),
        Schema.const(MuteDurationType.RANDOM),
      ]).default(MuteDurationType.STATIC),
      duration: Schema.number().default(5),
      minDuration: Schema.number().default(0.1),
      maxDuration: Schema.number().default(10),
      enableMessage: Schema.boolean().default(false),
      enableMuteOthers: Schema.boolean().default(true),
      probability: Schema.number().default(0.5).min(0).max(1),
    }),
  }).i18n({
    'zh-CN': require('./locales/zh-CN').muteconfig,
    'en-US': require('./locales/en-US').muteconfig,
  }),
])

export async function apply(ctx: Context, config: Config) {
    ctx.i18n.define('zh-CN', require('./locales/zh-CN'));
    ctx.i18n.define('en-US', require('./locales/en-US'));

  // 注册精致睡眠命令
  ctx.command('sleep')
    .alias('jzsm')
    .alias('精致睡眠')
    .action(async ({ session }) => {
      try {
        if (!session?.guildId) {
          const message = await session.send(session.text('commands.sleep.messages.guild_only'))
            .catch(() => null);

          if (message) {
            setTimeout(async () => {
              try {
                const messageId = Array.isArray(message) ? message[0] : message;
                await session.bot.deleteMessage(session.channelId, messageId);
              } catch (error) {
                console.error('Message recall failed:', error);
              }
            }, 5000);
          }
          return;
        }

        let duration: number;
        const now = new Date();
        const sleep = config.sleep;

        switch (sleep.type) {
          case 'static':
            duration = Math.max(1, sleep.duration);
            break;
          case 'until':
            const [hours, minutes] = sleep.until.split(':').map(Number);
            if (isNaN(hours) || isNaN(minutes)) {
              throw new Error(session.text('errors.invalid_time'));
            }
            const endTime = new Date(now);
            endTime.setHours(hours, minutes, 0, 0);
            if (endTime <= now) endTime.setDate(endTime.getDate() + 1);
            duration = Math.max(1, Math.floor((endTime.getTime() - now.getTime()) / 60000));
            break;
          case 'random':
            const min = Math.max(1, sleep.min);
            const max = Math.max(min, sleep.max);
            duration = Math.floor(Math.random() * (max - min + 1) + min);
            break;
        }

        await session.bot.muteGuildMember(session.guildId, session.userId, duration * 60 * 1000);
        return session.text('commands.sleep.messages.success');
      } catch (error) {
        return session.text('commands.sleep.messages.failed');
      }
    });

  // 注册手动点赞命令
  ctx.command('zanwo')
    .alias('赞我')
    .action(async ({ session }) => {
      if (!session?.userId) {
        return session.text('errors.invalid_session');
      }

      let successfulLikes = 0;
      const maxRetries = 3;

      for (let retry = 0; retry < maxRetries; retry++) {
        try {
          for (let i = 0; i < 5; i++) {
            await session.bot.internal.sendLike(session.userId, 10);
            successfulLikes += 1;
          }
          return session.text('commands.zanwo.messages.success', [config.notifyAccount]);
        } catch (error) {
          if (retry === maxRetries - 1) {
            return successfulLikes > 0
              ? session.text('commands.zanwo.messages.success', [config.notifyAccount])
              : session.text('errors.like_failed');
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    });

  // 注册自动点赞功能
  if (config.autoLikeList?.length > 0 && config.autoLikeTime) {
    try {
      const [hour, minute] = config.autoLikeTime.split(':').map(Number);
      if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        throw new Error('无效的时间格式');
      }

      ctx.cron(`0 ${minute} ${hour} * * *`, async () => {
        const results = [];

        for (const userId of config.autoLikeList) {
          let retryCount = 0;
          const maxRetries = 3;

          while (retryCount < maxRetries) {
            try {
              for (let i = 0; i < 5; i++) {
                await ctx.bots.first?.internal.sendLike(userId, 10);
              }
              results.push(`用户 ${userId} 点赞成功`);
              break;
            } catch (error) {
              retryCount++;
              if (retryCount === maxRetries) {
                results.push(`用户 ${userId} 点赞失败: ${error.message}`);
              }
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        }

        if (config.notifyAccount) {
          try {
            const resultMessage = results.join('\n');
            await ctx.bots.first?.sendPrivateMessage(config.notifyAccount, resultMessage);
          } catch (error) {
            console.error('发送通知消息失败:', error);
          }
        }
      });
    } catch (error) {
      console.error('自动点赞任务注册失败:', error);
    }
  }

  // 注册今日人品命令
  ctx.command('jrrp')
    .option('d', '-d <date>', { type: 'string' })
    .action(async ({ session, options }) => {
      try {
        if (!session?.userId) {
          throw new Error(session.text('errors.invalid_session'));
        }

        let targetDate = new Date();
        if (options?.d) {
          const date = parseDate(options.d, targetDate);
          if (!date) throw new Error(session.text('errors.invalid_date'));
          targetDate = date;
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
      } catch (error) {
        console.error('今日人品计算失败:', error);
        return session.text('commands.jrrp.messages.error');
      }
    });

  // 修改 mute 命令部分
  ctx.command('mute [duration:number]')
    .option('u', '-u [target:string]', { authority: 2 })
    .action(async ({ session, options }, duration) => {
      try {
        if (!session?.guildId) {
          return session.text('commands.mute.messages.guild_only');
        }

        // 获取用户昵称的函数
        async function getUserName(userId: string): Promise<string> {
          try {
            // 尝试从数据库获取用户信息
            const user = await ctx.database.getUser(session.platform, userId);
            return user?.name || userId;
          } catch (error) {
            console.error(`Failed to get user info for ${userId}:`, error);
            return userId;
          }
        }

        const random = new Random(() => Math.random());
        let muteDuration: number;

        // 计算禁言时长（秒）
        if (duration) {
          muteDuration = duration * 60; // 输入的时间依然按分钟计算
        } else if (config.mute.type === MuteDurationType.RANDOM) {
          // 随机时长精确到秒
          const minSeconds = config.mute.minDuration * 60;
          const maxSeconds = config.mute.maxDuration * 60;
          muteDuration = random.int(minSeconds, maxSeconds);
        } else {
          muteDuration = config.mute.duration * 60;
        }

        // 更新格式化显示时间函数
        const formatDuration = (seconds: number) => {
          const minutes = Math.floor(seconds / 60);
          const remainingSeconds = seconds % 60;
          if (remainingSeconds === 0) {
            return [minutes, null]; // 只有分钟
          }
          return [minutes, remainingSeconds]; // 分钟和秒
        };

        // 禁言指定目标
        if (options?.u) {
          if (!config.mute.enableMuteOthers) {
            return session.text('commands.mute.messages.mute_others_disabled');
          }

          const targetId = options.u.replace(/[<@!>]/g, '');
          // 获取目标用户昵称
          const targetName = await getUserName(targetId);

          if (random.bool(config.mute.probability)) {
            try {
              await session.onebot.setGroupBan(
                session.guildId,
                targetId,
                muteDuration
              );
              if (config.mute.enableMessage) {
                const [minutes, seconds] = formatDuration(muteDuration);
                return session.text('commands.mute.messages.target_success', [
                  targetName,
                  minutes,
                  seconds
                ].filter(Boolean));
              }
              return null;
            } catch (error) {
              console.error(`Failed to mute target ${targetId}:`, error);
              return session.text('commands.mute.messages.target_failed');
            }
          } else {
            // 获取自己的昵称
            const selfName = await getUserName(session.userId);
            try {
              await session.onebot.setGroupBan(
                session.guildId,
                session.userId,
                muteDuration
              );
              if (config.mute.enableMessage) {
                const [minutes, seconds] = formatDuration(muteDuration);
                return session.text('commands.mute.messages.probability_failed_self', [
                  minutes,
                  seconds
                ].filter(Boolean));
              }
              return null;
            } catch (error) {
              console.error(`Failed to self mute on probability failure ${session.userId}:`, error);
              return session.text('commands.mute.messages.failed');
            }
          }
        }

        // 禁言自己
        try {
          await session.onebot.setGroupBan(
            session.guildId,
            session.userId,
            muteDuration
          );
          if (config.mute.enableMessage) {
            const [minutes, seconds] = formatDuration(muteDuration);
            return session.text('commands.mute.messages.self_success', [
              minutes,
              seconds
            ].filter(Boolean));
          }
          return null;
        } catch (error) {
          console.error(`Failed to self mute ${session.userId}:`, error);
          return session.text('commands.mute.messages.failed');
        }
      } catch (error) {
        console.error('Mute command failed:', error);
        return session.text('commands.mute.messages.failed');
      }
    });

  // 辅助函数：解析日期
  function parseDate(dateStr: string, defaultDate: Date): Date | null {
    const fullDateMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const shortDateMatch = dateStr.match(/^(\d{1,2})-(\d{1,2})$/);

    try {
      if (fullDateMatch) {
        const [_, year, month, day] = fullDateMatch;
        return new Date(Number(year), Number(month) - 1, Number(day));
      } else if (shortDateMatch) {
        const [_, month, day] = shortDateMatch;
        return new Date(defaultDate.getFullYear(), Number(month) - 1, Number(day));
      }
    } catch {
      return null;
    }
    return null;
  }
}

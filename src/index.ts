// 导入必要的依赖
import { Context, Schema, Random, h } from 'koishi'
import {} from 'koishi-plugin-adapter-onebot'
import * as cron from 'koishi-plugin-cron'

// 插件基本信息
export const name = 'daily-tools'
export const inject = {
  required: ['database'],
  optional: ['cron']
}

// 今日人品计算的不同算法实现
export const enum JrrpAlgorithm {
  BASIC = 'basic',      // 基于简单哈希的随机算法
  GAUSSIAN = 'gaussian', // 基于正态分布的随机算法
  LINEAR = 'linear'     // 基于线性同余的随机算法
}

// 睡眠模式选项
export const enum SleepMode {
  STATIC = 'static',
  UNTIL = 'until',
  RANDOM = 'random'
}

// 禁言时长类型
export const enum MuteDurationType {
  STATIC = 'static',
  RANDOM = 'random'
}

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
  enableLikeReminder?: boolean
  choice?: JrrpAlgorithm
  specialMessages?: Record<number, string>
  rangeMessages?: Record<string, string>
  holidayMessages?: Record<string, string>
  mute: {
    type: MuteDurationType
    duration: number
    minDuration: number
    maxDuration: number
    maxAllowedDuration: number
    probability: number
    enableMessage: boolean
    enableMuteOthers: boolean
  }
}

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
    enableLikeReminder: Schema.boolean().default(true),
  }).i18n({
    'zh-CN': require('./locales/zh-CN').autolikeconfig,
    'en-US': require('./locales/en-US').autolikeconfig,
  }),

  Schema.object({
    mute: Schema.object({
      type: Schema.union([
        Schema.const(MuteDurationType.STATIC),
        Schema.const(MuteDurationType.RANDOM),
      ]).default(MuteDurationType.RANDOM),
      duration: Schema.number().default(5),
      minDuration: Schema.number().default(0.1),
      maxDuration: Schema.number().default(10),
      maxAllowedDuration: Schema.number().default(1440),
      enableMessage: Schema.boolean().default(false),
      enableMuteOthers: Schema.boolean().default(true),
      probability: Schema.number().default(0.5).min(0).max(1),
    }),
  }).i18n({
    'zh-CN': require('./locales/zh-CN').muteconfig,
    'en-US': require('./locales/en-US').muteconfig,
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
])

// 配置验证相关函数
const validateRangeMessages = (ctx: Context, rangeMessages: Record<string, string>): boolean => {
  const ranges: [number, number][] = [];

  for (const range of Object.keys(rangeMessages)) {
    const [start, end] = range.split('-').map(Number);
    if (isNaN(start) || isNaN(end) || start > end || start < 0 || end > 100) {
      ctx.logger.warn(ctx.i18n.define('errors.config.invalid_range', { value: range }));
      return false;
    }
    ranges.push([start, end]);
  }

  ranges.sort((a, b) => a[0] - b[0]);

  if (ranges[0][0] !== 0 || ranges[ranges.length - 1][1] !== 100) {
    ctx.logger.warn(ctx.i18n.define('errors.config.range_not_covered', {}));
    return false;
  }

  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i][0] !== ranges[i-1][1] + 1) {
      ctx.logger.warn(ctx.i18n.define('errors.config.range_overlap', { prev: String(ranges[i-1][1]), curr: String(ranges[i][0]) }));
      return false;
    }
  }

  return true;
};

// 配置整体验证函数
const validateConfig = (ctx: Context, config: Config): boolean => {
  if (config.autoLikeTime && !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(config.autoLikeTime)) {
    ctx.logger.warn(ctx.i18n.define('errors.config.invalid_autolike_time', {}));
    return false;
  }

  if (config.sleep.type === SleepMode.UNTIL &&
      !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(config.sleep.until)) {
    ctx.logger.warn(ctx.i18n.define('errors.config.invalid_sleep_time', {}));
    return false;
  }

  if (!validateRangeMessages(ctx, config.rangeMessages)) {
    return false;
  }

  return true;
};

export async function apply(ctx: Context, config: Config) {
  if (!validateConfig(ctx, config)) {
    throw new Error('Invalid configuration');
  }

  ctx.i18n.define('zh-CN', require('./locales/zh-CN'));
  ctx.i18n.define('en-US', require('./locales/en-US'));

  // 消息自动撤回处理
  const autoRecallMessage = async (session, message, delay = 10000) => {
    if (message) {
      setTimeout(() => {
          if (Array.isArray(message)) {
            for (const msg of message) {
              if (msg?.id) {
                session.bot.deleteMessage(session.channelId, msg.id);
              }
            }
          } else if (message?.id) {
            session.bot.deleteMessage(session.channelId, message.id);
          }
      }, delay);
    }
  };

  // 用户名称缓存管理
  const userCache = new Map<string, string>();

  // 获取用户显示名称(支持缓存)
  const getUserName = async (session, userId: string) => {
    const cacheKey = `${session.platform}:${userId}`;
    if (userCache.has(cacheKey)) {
      return userCache.get(cacheKey);
    }
    const user = await ctx.database.getUser(session.platform, userId);
    const name = user?.name || userId;
    userCache.set(cacheKey, name);
    return name;
  };

  // 禁言操作核心处理函数
  const handleMute = async (session, targetId: string, duration: number) => {
    await session.onebot.setGroupBan(session.guildId, targetId, duration)
    if (session.messageId) {
      try {
        await session.bot.deleteMessage(session.channelId, session.messageId)
      } catch {
        // 忽略撤回失败
      }
    }
    return true
  }

  // 发送禁言结果通知
  const sendMuteResultMessage = async (session, targetId: string, duration: number, showMessage = true) => {
    if (showMessage && config.mute.enableMessage) {
      const [minutes, seconds] = [(duration / 60) | 0, duration % 60]
      const message = await session.send(session.text(
        targetId === session.userId
          ? 'commands.mute.messages.notify.self_muted'
          : 'commands.mute.messages.notify.target_muted',
        [await getUserName(session, targetId), minutes, seconds].filter(Boolean)
      ))
      await autoRecallMessage(session, message)
    }
  }

  // 精致睡眠命令 - 支持多种睡眠模式
  ctx.command('sleep')
    .alias('jzsm', '精致睡眠')
    .action(async ({ session }) => {
      try {
        if (!session?.guildId) {
          const message = await session.send(session.text('commands.sleep.messages.guild_only'));
          await autoRecallMessage(session, message);
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
        const message = await session.send(session.text('commands.sleep.messages.failed'));
        await autoRecallMessage(session, message);
        return;
      }
    });

  // 点赞命令 - 支持自动重试
  ctx.command('zanwo')
    .alias('赞我')
    .action(async ({ session }) => {
      if (!session?.userId) {
        const message = await session.send(session.text('errors.invalid_session'));
        await autoRecallMessage(session, message);
        return;
      }

      let successfulLikes = 0;
      const maxRetries = 3;

      for (let retry = 0; retry < maxRetries; retry++) {
        try {
          await Promise.all(Array(5).fill(null).map(() =>
            session.bot.internal.sendLike(session.userId, 10)
          ));
          successfulLikes = 5;

          const message = await session.send(
            config.enableLikeReminder
              ? session.text('commands.zanwo.messages.success', [config.notifyAccount])
              : session.text('commands.zanwo.messages.success_no_reminder')
          );

          await autoRecallMessage(session, message);
          return null;
        } catch (error) {
          if (retry === maxRetries - 1) {
            const errorMessage = await session.send(
              successfulLikes > 0
                ? (config.enableLikeReminder
                  ? session.text('commands.zanwo.messages.success', [config.notifyAccount])
                  : session.text('commands.zanwo.messages.success_no_reminder'))
                : session.text('errors.like_failed')
            );

            await autoRecallMessage(session, errorMessage);
            return null;
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    });

  // 自动点赞定时任务配置
  if (config.autoLikeList?.length > 0 && config.autoLikeTime) {
    const [hour, minute] = config.autoLikeTime.split(':').map(Number);
    if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      throw new Error('Invalid time format');
    }

    ctx.cron(`0 ${minute} ${hour} * * *`, async () => {
      const results = await Promise.all(config.autoLikeList.map(async (userId) => {
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount < maxRetries) {
          try {
            await Promise.all(Array(5).fill(null).map(() =>
              ctx.bots.first?.internal.sendLike(userId, 10)
            ));
            return `User ${userId} like succeeded`;
          } catch (error) {
            retryCount++;
            if (retryCount === maxRetries) {
              return `User ${userId} like failed: ${error.message}`;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }));

      if (config.notifyAccount) {
        const resultMessage = results.join('\n');
        await ctx.bots.first?.sendPrivateMessage(config.notifyAccount, resultMessage);
      }
    });
  }

  // 禁言命令 - 支持多种模式和概率控制
  ctx.command('mute [duration:number]')
    .option('u', '-u <target:text>')
    .option('r', '-r')
    .action(async ({ session, options }, duration) => {
      if (!session?.guildId) {
        const message = await session.send(session.text('commands.mute.messages.errors.guild_only'))
        await autoRecallMessage(session, message)
        return
      }

      if (!config.mute.enableMuteOthers && (options?.u || options?.r)) {
        const message = await session.send(session.text('commands.mute.messages.notify.others_disabled'))
        await autoRecallMessage(session, message)
        return
      }

      if (duration && duration > config.mute.maxAllowedDuration) {
        const message = await session.send(session.text('commands.mute.messages.errors.duration_too_long', [config.mute.maxAllowedDuration]))
        await autoRecallMessage(session, message)
        return
      }

      let random = new Random()
      let muteDuration = duration ? duration * 60
        : config.mute.type === MuteDurationType.RANDOM
          ? random.int(config.mute.minDuration * 60, config.mute.maxDuration * 60)
          : config.mute.duration * 60

        if (options?.r) {
          const members = (await session.onebot.getGroupMemberList(session.guildId))
            .filter(m => m.role === 'member' && String(m.user_id) !== String(session.selfId))
            .map(m => String(m.user_id))

          if (!members.length) {
            const message = await session.send(session.text('commands.mute.messages.no_valid_members'))
            await autoRecallMessage(session, message)
            return
          }

          if (!random.bool(config.mute.probability)) {
            await handleMute(session, session.userId, muteDuration)
            await sendMuteResultMessage(session, session.userId, muteDuration)
            return
          }

          const targetId = random.pick(members)
          await handleMute(session, targetId, muteDuration)
          await sendMuteResultMessage(session, targetId, muteDuration)
          return
        }

        if (options?.u) {
          const parsedUser = h.parse(options.u)[0]
          const targetId = parsedUser?.type === 'at' ? parsedUser.attrs.id : options.u.trim()

          if (!targetId || targetId === session.userId) {
            await handleMute(session, session.userId, muteDuration)
            await sendMuteResultMessage(session, session.userId, muteDuration)
            return
          }

          if (!random.bool(config.mute.probability)) {
            await handleMute(session, session.userId, muteDuration)
            await sendMuteResultMessage(session, session.userId, muteDuration)
            return
          }

          await handleMute(session, targetId, muteDuration)
          await sendMuteResultMessage(session, targetId, muteDuration)
          return
        }

        await handleMute(session, session.userId, muteDuration)
        await sendMuteResultMessage(session, session.userId, muteDuration)
    })

  // 今日人品计算命令 - 支持多种随机算法
  ctx.command('jrrp')
    .option('d', '-d <date>', { type: 'string' })
    .action(async ({ session, options }) => {
      try {
        if (!session?.userId) {
          const message = await session.send(session.text('errors.invalid_session'));
          await autoRecallMessage(session, message);
          return;
        }

        let targetDate = new Date();
        if (options?.d) {
          const date = parseDate(options.d, targetDate);
          if (!date) {
            const message = await session.send(session.text('errors.invalid_date'));
            await autoRecallMessage(session, message);
            return;
          }
          targetDate = date;
        }

        const year = targetDate.getFullYear();
        const monthStr = String(targetDate.getMonth() + 1).padStart(2, '0');
        const dayStr = String(targetDate.getDate()).padStart(2, '0');
        const currentDateStr = `${year}-${monthStr}-${dayStr}`;
        const monthDay = `${monthStr}-${dayStr}`;

        if (config.holidayMessages?.[monthDay]) {
          await session.send(session.text(config.holidayMessages[monthDay] + 'commands.jrrp.messages.prompt'));
          const response = await session.prompt(10000);
          if (!response) {
            return session.text('commands.jrrp.messages.cancel');
          }
        }

        const userNickname = session.username || 'User'

        // 32位哈希值计算函数
        function hashCode(str: string): number {
          let hash = 5381
          for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) + str.charCodeAt(i)
            hash = hash >>> 0
          }
          return hash
        }

        let luckScore: number
        const userDateSeed = `${session.userId}-${currentDateStr}`

        // 根据选择的算法计算今日人品值
        switch (config.choice || 'basic') {
          case 'basic': {
            // 基础算法：直接哈希取模
            const modLuck = Math.abs(hashCode(userDateSeed)) % 101
            luckScore = modLuck
            break
          }
          case 'gaussian': {
            // 高斯分布算法：生成近似正态分布的随机数
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
            // 线性同余算法：使用线性同余方法生成伪随机数
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

        // 根据分数范围和特殊值生成对应消息
        let message = session.text('commands.jrrp.messages.result', [luckScore, userNickname])
        if (config.specialMessages && luckScore in config.specialMessages) {
          message += session.text(config.specialMessages[luckScore])
        } else if (config.rangeMessages) {
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
        console.error('Daily fortune calculation failed:', error);
        const message = await session.send(session.text('commands.jrrp.messages.error'));
        await autoRecallMessage(session, message);
        return;
      }
    });

  // 日期解析辅助函数 - 支持完整日期和短格式日期
  function parseDate(dateStr: string, defaultDate: Date): Date | null {
    const fullDateMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const shortDateMatch = dateStr.match(/^(\d{1,2})-(\d{1,2})$/);

    if (fullDateMatch) {
      const [_, year, month, day] = fullDateMatch;
      return new Date(Number(year), Number(month) - 1, Number(day));
    } else if (shortDateMatch) {
      const [_, month, day] = shortDateMatch;
      return new Date(defaultDate.getFullYear(), Number(month) - 1, Number(day));
    }
    return null;
  }
}

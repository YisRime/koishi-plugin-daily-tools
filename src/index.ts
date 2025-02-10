// 导入必要的依赖
import { Context, Schema, Random, h } from 'koishi'
import {} from 'koishi-plugin-adapter-onebot'
import * as cron from 'koishi-plugin-cron'

// 添加 Date 类型扩展声明
declare global {
  interface Date {
    getDayOfYear(): number;
  }
}

// 实现 getDayOfYear 方法
Date.prototype.getDayOfYear = function() {
  const start = new Date(this.getFullYear(), 0, 0);
  const now = new Date(this.valueOf());
  const diff = now.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
};

// GetHash 函数实现
function GetHash(str: string): bigint {
  let hash = BigInt(5381);
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << BigInt(5)) ^ hash ^ BigInt(str.charCodeAt(i))) & ((BigInt(1) << BigInt(64)) - BigInt(1));
  }
  return hash ^ BigInt('0xa98f501bc684032f');
}

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
  enabled: boolean
  list?: string[]
  time?: string
  notifyAccount?: string
  enableReminder?: boolean
  choice?: JrrpAlgorithm
  specialPassword?: string  // 新增：特殊模式密码
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
      duration: Schema.number().default(8),   // 修改默认为8小时
      until: Schema.string().default('08:00'),
      min: Schema.number().default(6),        // 修改默认为6小时
      max: Schema.number().default(10),       // 修改默认为10小时
    }),
  }).i18n({
    'zh-CN': require('./locales/zh-CN').sleepconfig,
    'en-US': require('./locales/en-US').sleepconfig,
  }),

  // 修改 autolike 配置：扁平化结构，移除原 autoLike 子对象
  Schema.object({
    enabled: Schema.boolean().default(false),
    list: Schema.array(String),
    time: Schema.string().default('00:00'),
    notifyAccount: Schema.string(),
    enableReminder: Schema.boolean().default(true),
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
    specialPassword: Schema.string().default('PASSWORD').role('secret'),
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

// 配置验证相关类
class ConfigValidator {
  constructor(private ctx: Context, private config: Config) {}

  private validateTimeFormat(time: string): boolean {
    return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time);
  }

  private validateAutoLike(): void {
    if (this.config.enabled && this.config.time) {
      if (!this.validateTimeFormat(this.config.time)) {
        throw new Error('Invalid auto-like time format');
      }
    }
  }

  private validateSleepTime(): void {
    if (this.config.sleep.type === SleepMode.UNTIL &&
        !this.validateTimeFormat(this.config.sleep.until)) {
      throw new Error('Invalid sleep end time format');
    }
  }

  private validateRangeMessages(): void {
    const ranges: [number, number][] = [];

    for (const range of Object.keys(this.config.rangeMessages)) {
      const [start, end] = range.split('-').map(Number);
      if (isNaN(start) || isNaN(end) || start > end || start < 0 || end > 100) {
        throw new Error(`Invalid range format: ${range}`);
      }
      ranges.push([start, end]);
    }

    ranges.sort((a, b) => a[0] - b[0]);

    if (ranges[0][0] !== 0 || ranges[ranges.length - 1][1] !== 100) {
      throw new Error('Ranges must completely cover 0 to 100');
    }

    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i][0] !== ranges[i-1][1] + 1) {
        throw new Error(`Overlap or gap between ranges ${ranges[i-1][1]} and ${ranges[i][0]}`);
      }
    }
  }

  validate(): void {
    this.validateAutoLike();
    this.validateSleepTime();
    this.validateRangeMessages();
  }
}

// 整合工具函数为一个统一的工具对象
const utils = {
  // 消息自动撤回处理
  async autoRecall(session, message, delay = 10000) {
    if (!message) return;
    setTimeout(() => {
      if (Array.isArray(message)) {
        message.forEach(msg => msg?.id && session.bot.deleteMessage(session.channelId, msg.id));
      } else if (message?.id) {
        session.bot.deleteMessage(session.channelId, message.id);
      }
    }, delay);
  },

  // 简化的消息发送和撤回
  async sendAndRecall(session, text: string, params: any[] = [], delay = 10000) {
    const message = await session.send(session.text(text, params));
    await this.autoRecall(session, message, delay);
    return message;
  },

  // 带缓存的用户名称获取
  userCache: new Map<string, string>(),
  async getUserName(ctx: Context, session, userId: string) {
    const cacheKey = `${session.platform}:${userId}`;
    if (this.userCache.has(cacheKey)) return this.userCache.get(cacheKey);
    const user = await ctx.database.getUser(session.platform, userId);
    const name = user?.name || userId;
    this.userCache.set(cacheKey, name);
    return name;
  },

  // 特殊码存储相关
  SPECIAL_CODES_PATH: 'data/special-codes.json',
  specialCodes: new Map<string, string>(),
  validateSpecialCode: (code: string) => /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/i.test(code),

  // 日期相关工具
  parseDate(dateStr: string, defaultDate: Date): Date | null {
    const fullMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const shortMatch = dateStr.match(/^(\d{1,2})-(\d{1,2})$/);
    if (fullMatch) {
      const [_, year, month, day] = fullMatch;
      return new Date(Number(year), Number(month) - 1, Number(day));
    } else if (shortMatch) {
      const [_, month, day] = shortMatch;
      return new Date(defaultDate.getFullYear(), Number(month) - 1, Number(day));
    }
    return null;
  },
};

// 简化的命令处理器
class CommandHandler {
  constructor(private ctx: Context, private config: Config) {}

  // 处理不同的禁言场景
  async handleMute(session, targetId: string, duration: number, showMessage = true) {
    await session.onebot.setGroupBan(session.guildId, targetId, duration);
    if (session.messageId) {
      try {
        await session.bot.deleteMessage(session.channelId, session.messageId);
      } catch {}
    }
    if (showMessage && this.config.mute.enableMessage) {
      const [minutes, seconds] = [(duration / 60) | 0, duration % 60];
      const message = await session.send(session.text(
        targetId === session.userId
          ? 'commands.mute.messages.notify.self_muted'
          : 'commands.mute.messages.notify.target_muted',
        [await utils.getUserName(this.ctx, session, targetId), minutes, seconds].filter(Boolean)
      ));
      await utils.autoRecall(session, message);
    }
    return true;
  }

  // ... 其他命令处理方法
}

export async function apply(ctx: Context, config: Config) {
  try {
    new ConfigValidator(ctx, config).validate();
  } catch (error) {
    ctx.logger.error('Configuration validation failed:', error.message);
    throw error;
  }

  ctx.i18n.define('zh-CN', require('./locales/zh-CN'));
  ctx.i18n.define('en-US', require('./locales/en-US'));

  const handler = new CommandHandler(ctx, config);

  // 命令注册部分
  ctx.command('sleep')
    .alias('jzsm', '精致睡眠')
    .action(async ({ session }) => {
      try {
        if (!session?.guildId) {
          await utils.sendAndRecall(session, 'commands.sleep.messages.guild_only');
          return;
        }

        let duration: number;
        const now = new Date();
        const sleep = config.sleep;

        switch (sleep.type) {
          case 'static':
            // 将小时乘60转换为分钟
            duration = Math.max(1, sleep.duration) * 60;
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
            // 将配置小时转换为分钟
            const min = Math.max(1, sleep.min) * 60;
            const max = Math.max(sleep.max, sleep.min) * 60;
            duration = Math.floor(Math.random() * (max - min + 1) + min);
            break;
        }

        await session.bot.muteGuildMember(session.guildId, session.userId, duration * 60 * 1000);
        // 移除对晚安消息的自动撤回
        return session.text('commands.sleep.messages.success');
      } catch (error) {
        await utils.sendAndRecall(session, 'commands.sleep.messages.failed');
        return;
      }
    });

  ctx.command('zanwo')
    .alias('赞我')
    .action(async ({ session }) => {
      if (!session?.userId) {
        await utils.sendAndRecall(session, 'errors.invalid_session');
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

          await utils.sendAndRecall(
            session,
            config.enableReminder
              ? 'commands.zanwo.messages.success'
              : 'commands.zanwo.messages.success_no_reminder',
            [config.notifyAccount]
          );
          return null;
        } catch (error) {
          if (retry === maxRetries - 1) {
            await utils.sendAndRecall(
              session,
              successfulLikes > 0
                ? (config.enableReminder
                  ? 'commands.zanwo.messages.success'
                  : 'commands.zanwo.messages.success_no_reminder')
                : 'commands.zanwo.messages.like_failed',  // 修改这里的错误消息路径
              [config.notifyAccount]
            );
            return null;
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    });

  ctx.command('mute [duration:number]')
    .option('u', '-u <target:text>')
    .option('r', '-r')
    .action(async ({ session, options }, duration) => {
      if (!session?.guildId) {
        await utils.sendAndRecall(session, 'commands.mute.messages.errors.guild_only');
        return;
      }

      if (!config.mute.enableMuteOthers && (options?.u || options?.r)) {
        await utils.sendAndRecall(session, 'commands.mute.messages.notify.others_disabled');
        return;
      }

      if (duration && duration > config.mute.maxAllowedDuration) {
        await utils.sendAndRecall(session, 'commands.mute.messages.errors.duration_too_long', [config.mute.maxAllowedDuration]);
        return;
      }

      let random = new Random();
      let muteDuration = duration ? duration * 60
        : config.mute.type === MuteDurationType.RANDOM
          ? random.int(config.mute.minDuration * 60, config.mute.maxDuration * 60)
          : config.mute.duration * 60;

      if (options?.r) {
        const members = (await session.onebot.getGroupMemberList(session.guildId))
          .filter(m => m.role === 'member' && String(m.user_id) !== String(session.selfId))
          .map(m => String(m.user_id));

        if (!members.length) {
          await utils.sendAndRecall(session, 'commands.mute.messages.no_valid_members');
          return;
        }

        if (!random.bool(config.mute.probability)) {
          await handler.handleMute(session, session.userId, muteDuration);
          return;
        }

        const targetId = random.pick(members);
        await handler.handleMute(session, targetId, muteDuration);
        return;
      }

      if (options?.u) {
        const parsedUser = h.parse(options.u)[0];
        const targetId = parsedUser?.type === 'at' ? parsedUser.attrs.id : options.u.trim();

        if (!targetId || targetId === session.userId) {
          await handler.handleMute(session, session.userId, muteDuration);
          return;
        }

        if (!random.bool(config.mute.probability)) {
          await handler.handleMute(session, session.userId, muteDuration);
          return;
        }

        await handler.handleMute(session, targetId, muteDuration);
        return;
      }

      await handler.handleMute(session, session.userId, muteDuration);
    });

  ctx.command('jrrp')
    .option('d', '-d <date>', { type: 'string' })
    .option('b', '-b <code>', { type: 'string' })
    .action(async ({ session, options }) => {
      // 识别码存储
      const specialCodes = new Map<string, string>();
      const SPECIAL_CODES_PATH = 'data/special-codes.json';

      // 加载识别码数据
      try {
        const fs = require('fs');
        if (fs.existsSync(SPECIAL_CODES_PATH)) {
          const data = JSON.parse(fs.readFileSync(SPECIAL_CODES_PATH, 'utf8'));
          Object.entries(data).forEach(([userId, code]) => {
            specialCodes.set(userId, code as string);
          });
        }
      } catch (error) {
        ctx.logger.error('Failed to load special codes:', error);
      }

      // 保存识别码数据
      const saveSpecialCodes = () => {
        const fs = require('fs');
        const data = Object.fromEntries(specialCodes);
        fs.writeFileSync(SPECIAL_CODES_PATH, JSON.stringify(data, null, 2));
      };

      // 验证识别码格式
      const validateSpecialCode = (code: string): boolean => {
        return /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/i.test(code);
      };

      // 处理绑定识别码
      if (options?.b) {
        if (!options.b || !validateSpecialCode(options.b)) {
          return session.text('commands.jrrp.messages.special_mode.invalid_code');
        }

        specialCodes.set(session.userId, options.b.toUpperCase());
        saveSpecialCodes();
        return session.text('commands.jrrp.messages.special_mode.bind_success');
      }

      try {
        if (!session?.userId) {
          await utils.sendAndRecall(session, 'errors.invalid_session');
          return;
        }

        let targetDate = new Date();
        if (options?.d) {
          const date = utils.parseDate(options.d, targetDate);
          if (!date) {
            await utils.sendAndRecall(session, 'errors.invalid_date');
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
          const promptMessage = await session.send(session.text(config.holidayMessages[monthDay] + 'commands.jrrp.messages.prompt'));
          // 添加对提示消息的自动撤回
          await utils.autoRecall(session, promptMessage);
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

        // 检查是否有绑定的识别码
        const specialCode = specialCodes.get(session.userId);

        if (specialCode) {
          // 如果有识别码，使用特殊模式计算
          luckScore = calculateSpecialJrrp(specialCode, targetDate, config.specialPassword);
        } else {
          // 如果没有识别码，使用选择的算法计算
          switch (config.choice) {
            case 'basic': {
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
              luckScore = Math.abs(hashCode(userDateSeed)) % 101
            }
          }
        }

        // 根据分数范围和特殊值生成对应消息
        let message = session.text('commands.jrrp.messages.result', [luckScore, userNickname]);
        if (config.specialMessages && luckScore in config.specialMessages) {
          message += session.text(config.specialMessages[luckScore]);
        } else if (config.rangeMessages) {
          for (const [range, msg] of Object.entries(config.rangeMessages)) {
            const [min, max] = range.split('-').map(Number);
            if (!isNaN(min) && !isNaN(max) && luckScore >= min && luckScore <= max) {
              message += session.text(msg);
              break;
            }
          }
        }
        return message;
      } catch (error) {
        console.error('Daily fortune calculation failed:', error);
        await utils.sendAndRecall(session, 'commands.jrrp.messages.error');
        return;
      }
    });

  // 自动点赞定时任务配置
  if (config.enabled && config.list?.length > 0 && config.time) {
    const [hour, minute] = config.time.split(':').map(Number);
    if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      throw new Error('Invalid time format');
    }

    ctx.cron(`0 ${minute} ${hour} * * *`, async () => {
      const results = await Promise.all(config.list.map(async (userId) => {
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

  // 在 jrrp 命令实现中，修改特殊模式计算函数
  function calculateSpecialJrrp(specialCode: string, date: Date, password: string): number {
    const dayOfYear = date.getDayOfYear();
    const year = date.getFullYear();
    const day = date.getDate();

    // 第一个哈希计算
    const hash1 = GetHash([
      'asdfgbn',
      String(dayOfYear),
      '12#3$45',
      String(year),
      'IUY'
    ].join(''));

    // 第二个哈希计算，使用配置的密码
    const hash2 = GetHash([
      password,
      specialCode,
      '0*8&6',
      String(day),
      'kjhg'
    ].join(''));

    // 使用 BigInt 处理除法计算
    const div3 = BigInt(3);
    const hash1Div3 = hash1 / div3;
    const hash2Div3 = hash2 / div3;

    const combined = Math.abs(Number(hash1Div3 + hash2Div3) / 527.0);
    const num = Math.round(combined) % 1001;

    return num >= 970 ? 100 : Math.round((num / 969.0) * 99.0);
  }
}

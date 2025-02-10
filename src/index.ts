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
  enabled: boolean
  list?: string[]
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
    this.validateSleepTime();
    this.validateRangeMessages();
  }
}

// 整合工具函数为一个统一的工具对象
const utils = {
  // 消息自动撤回处理
  async autoRecall(session, message, delay = 10000) {
    if (!message) return;
    setTimeout(async () => {
      try {
        if (Array.isArray(message)) {
          await Promise.all(message.map(msg => {
            const msgId = typeof msg === 'string' ? msg : msg?.id;
            if (msgId) return session.bot.deleteMessage(session.channelId, msgId);
          }));
        } else {
          const msgId = typeof message === 'string' ? message : message?.id;
          if (msgId) await session.bot.deleteMessage(session.channelId, msgId);
        }
      } catch (e) {
        console.error('Failed to recall message:', e);
      }
    }, delay);
  },

  // 简化的消息发送和撤回
  async sendAndRecall(session, text: string, params: any[] = [], delay = 10000) {
    try {
      const message = await session.send(session.text(text, params));
      if (message) {
        const msgId = typeof message === 'string' ? message : message?.id;
        await this.autoRecall(session, msgId, delay);
      }
      return message;
    } catch (e) {
      console.error('Failed to send or recall message:', e);
      return null;
    }
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

  // 添加全局 hashCode 函数
  hashCode(str: string): number {
    let hash = 5381;
    for (let i = 0; str.length > i; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash >>> 0;
    }
    return hash;
  }
};

// 新增 JrrpSpecialMode 类，放在 CommandHandler 之前
class JrrpSpecialMode {
  private specialCodes = new Map<string, string>();
  private first100Records = new Map<string, boolean>();
  private readonly JRRP_DATA_PATH = 'data/jrrp.json';

  constructor(private ctx: Context) {
    this.loadData();
  }

  // 移入 getDayOfYear 实现
  private getDayOfYear(date: Date): number {
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date.getTime() - start.getTime();
    const oneDay = 1000 * 60 * 60 * 24;
    return Math.floor(diff / oneDay);
  }

  // 移入 GetHash 实现
  private getHash(str: string): bigint {
    let hash = BigInt(5381);
    for (let i = 0; str.length > i; i++) {
      hash = ((hash << BigInt(5)) ^ hash ^ BigInt(str.charCodeAt(i))) & ((BigInt(1) << BigInt(64)) - BigInt(1));
    }
    return hash ^ BigInt('0xa98f501bc684032f');
  }

  private loadData(): void {
    try {
      const fs = require('fs');
      if (fs.existsSync(this.JRRP_DATA_PATH)) {
        const data = JSON.parse(fs.readFileSync(this.JRRP_DATA_PATH, 'utf8'));
        // 加载识别码
        if (data.codes) {
          Object.entries(data.codes).forEach(([userId, code]) => {
            this.specialCodes.set(userId, code as string);
          });
        }
        // 加载首次100记录
        if (data.first100) {
          Object.entries(data.first100).forEach(([userId, hadFirst100]) => {
            this.first100Records.set(userId, hadFirst100 as boolean);
          });
        }
      }
    } catch (error) {
      this.ctx.logger.error('Failed to load JRRP data:', error);
    }
  }

  private saveData(): void {
    const fs = require('fs');
    const data = {
      codes: Object.fromEntries(this.specialCodes),
      first100: Object.fromEntries(this.first100Records)
    };
    fs.writeFileSync(this.JRRP_DATA_PATH, JSON.stringify(data, null, 2));
  }

  markFirst100(userId: string): void {
    this.first100Records.set(userId, true);
    this.saveData();
  }

  isFirst100(userId: string): boolean {
    return !this.first100Records.get(userId);
  }

  validateSpecialCode(code: string): boolean {
    return /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/i.test(code);
  }

  bindSpecialCode(userId: string, code: string): void {
    this.specialCodes.set(userId, code.toUpperCase());
    this.saveData();
  }

  removeSpecialCode(userId: string): void {
    this.specialCodes.delete(userId);
    this.saveData();
  }

  getSpecialCode(userId: string): string | undefined {
    return this.specialCodes.get(userId);
  }

  calculateSpecialJrrp(specialCode: string, date: Date, password: string): number {
    const dayOfYear = this.getDayOfYear(date);
    const year = date.getFullYear();
    const day = date.getDate();

    const hash1 = this.getHash([
      'asdfgbn',
      String(dayOfYear),
      '12#3$45',
      String(year),
      'IUY'
    ].join(''));

    const hash2 = this.getHash([
      password,
      specialCode,
      '0*8&6',
      String(day),
      'kjhg'
    ].join(''));

    const div3 = BigInt(3);
    const hash1Div3 = hash1 / div3;
    const hash2Div3 = hash2 / div3;

    const combined = Math.abs(Number(hash1Div3 + hash2Div3) / 527.0);
    const num = Math.round(combined) % 1001;

    return num >= 970 ? 100 : Math.round((num / 969.0) * 99.0);
  }
}


async function handleMute(session, targetId: string, duration: number, config: Config) {
  try {
    await session.onebot.setGroupBan(session.guildId, targetId, duration);

    // 删除触发命令的消息
    if (session.messageId) {
      try {
        await session.bot.deleteMessage(session.channelId, session.messageId);
      } catch {}
    }

    // 只在启用消息提示时发送通知
    if (config.mute.enableMessage) {
      const [minutes, seconds] = [(duration / 60) | 0, duration % 60];
      const isTargetSelf = targetId === session.userId;

      const messageKey = isTargetSelf
        ? 'commands.mute.messages.notify.self_muted'
        : 'commands.mute.messages.notify.target_muted';

      const params = isTargetSelf
        ? [minutes, seconds]
        : [await utils.getUserName(session.ctx, session, targetId), minutes, seconds];

      const message = await session.send(session.text(messageKey, params));
      await utils.autoRecall(session, message);
    }
    return true;
  } catch (error) {
    console.error('Mute operation failed:', error);
    return false;
  }
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

  const jrrpSpecial = new JrrpSpecialMode(ctx);

  // 添加计算分数的统一函数
  function calculateScore(userDateSeed: string, date: Date, specialCode: string | undefined): number {
    if (specialCode) {
      return jrrpSpecial.calculateSpecialJrrp(specialCode, date, config.specialPassword);
    }

    switch (config.choice) {
      case 'basic': {
        return Math.abs(utils.hashCode(userDateSeed)) % 101;
      }
      case 'gaussian': {
        const normalRandom = (seed: string): number => {
          const hash = utils.hashCode(seed);
          const randomFactor = Math.sin(hash) * 10000;
          return randomFactor - Math.floor(randomFactor);
        };

        const toNormalLuck = (random: number): number => {
          const u1 = random;
          const u2 = normalRandom(random.toString());
          const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
          return Math.min(100, Math.max(0, Math.round(z * 15 + 50)));
        };

        const dateWeight = (date.getDay() + 1) / 7;
        const baseRandom = normalRandom(userDateSeed);
        const weightedRandom = (baseRandom + dateWeight) / 2;
        return toNormalLuck(weightedRandom);
      }
      case 'linear': {
        const lcgSeed = utils.hashCode(userDateSeed);
        return Math.floor(((lcgSeed * 9301 + 49297) % 233280) / 233280 * 101);
      }
      default: {
        return Math.abs(utils.hashCode(userDateSeed)) % 101;
      }
    }
  }

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
            // 直接使用 utils.sendAndRecall 处理失败消息
            await utils.sendAndRecall(
              session,
              'commands.zanwo.messages.like_failed',
              []
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
          await handleMute(session, session.userId, muteDuration, config);
          return;
        }

        const targetId = random.pick(members);
        await handleMute(session, targetId, muteDuration, config);
        return;
      }

      if (options?.u) {
        const parsedUser = h.parse(options.u)[0];
        const targetId = parsedUser?.type === 'at' ? parsedUser.attrs.id : options.u.trim();

        if (!targetId || targetId === session.userId) {
          await handleMute(session, session.userId, muteDuration, config);
          return;
        }

        if (!random.bool(config.mute.probability)) {
          await handleMute(session, session.userId, muteDuration, config);
          return;
        }

        await handleMute(session, targetId, muteDuration, config);
        return;
      }

      await handleMute(session, session.userId, muteDuration, config);
    });

  ctx.command('jrrp')
    .option('d', '-d <date>', { type: 'string' })
    .option('b', '-b <code>', { type: 'string' })
    .option('g', '-g <number:number>', { fallback: null })
    .action(async ({ session, options }) => {
      // 首先确保会话有效
      if (!session?.userId) {
        await utils.sendAndRecall(session, 'errors.invalid_session');
        return;
      }

      // 处理 -g 选项
      if ('g' in options && options.g !== null) {
        // 验证输入范围是否在0-100之间
        if (options.g < 0 || options.g > 100) {
          await utils.sendAndRecall(session, 'commands.jrrp.messages.invalid_number');
          return;
        }

        // 计算下一次出现该分数的日期
        let currentDate = new Date();
        let daysChecked = 0;
        const maxDaysToCheck = 365;

        while (daysChecked < maxDaysToCheck) {
          currentDate.setDate(currentDate.getDate() + 1);
          const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
          const userDateSeed = `${session.userId}-${dateStr}`;
          const specialCode = jrrpSpecial.getSpecialCode(session.userId);
          const score = calculateScore(userDateSeed, currentDate, specialCode);

          if (score === options.g) {
            session.send(session.text('commands.jrrp.messages.found_date', [
              options.g,
              `${currentDate.getFullYear().toString().slice(-2)}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`
            ]));
            return;
          }

          daysChecked++;
        }

        await utils.sendAndRecall(session, 'commands.jrrp.messages.not_found', [options.g]);
        return;
      }

      // 处理绑定识别码，确保错误消息自动撤回
      if ('b' in options) {
        try {
          // 撤回命令消息
          if (session.messageId) {
            await session.bot.deleteMessage(session.channelId, session.messageId);
          }

          if (!options.b) {
            const message = await session.send(session.text('commands.jrrp.messages.special_mode.unbind_success'));
            await utils.autoRecall(session, message);
            jrrpSpecial.removeSpecialCode(session.userId);
            return;
          }

          if (!jrrpSpecial.validateSpecialCode(options.b)) {
            const message = await session.send(session.text('commands.jrrp.messages.special_mode.invalid_code'));
            await utils.autoRecall(session, message);
            return;
          }

          const message = await session.send(session.text('commands.jrrp.messages.special_mode.bind_success'));
          await utils.autoRecall(session, message);
          jrrpSpecial.bindSpecialCode(session.userId, options.b);
          return;
        } catch (e) {
          console.error('Failed to handle special code binding:', e);
        }
      }

      // 处理日期参数
      let targetDate = new Date();
      if (options?.d) {
        const parseDate = (dateStr: string, defaultDate: Date): Date | null => {
          // 统一格式：将.和/转换为-，移除所有空白字符
          const normalizedDate = dateStr.replace(/[\s.\/]/g, '-').replace(/-+/g, '-');

          // 匹配完整日期：YYYY-MM-DD、YYYY-M-D
          const fullMatch = normalizedDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
          // 匹配短年份：YY-MM-DD、YY-M-D、YY/M/D等
          const shortYearMatch = normalizedDate.match(/^(\d{1,2})-(\d{1,2})-(\d{1,2})$/);
          // 匹配短日期：MM-DD、M-D
          const shortMatch = normalizedDate.match(/^(\d{1,2})-(\d{1,2})$/);

          if (fullMatch) {
            const [_, year, month, day] = fullMatch;
            const date = new Date(Number(year), Number(month) - 1, Number(day));
            if (date.getFullYear() === Number(year) &&
                date.getMonth() === Number(month) - 1 &&
                date.getDate() === Number(day)) {
              return date;
            }
            return null;
          } else if (shortYearMatch) {
            const [_, year, month, day] = shortYearMatch;
            // 智能处理两位年份
            let fullYear: number;
            const yearNum = Number(year);
            const currentYear = defaultDate.getFullYear();
            const currentYearLastTwo = currentYear % 100;

            if (yearNum >= 0 && yearNum <= 99) {
              // 如果年份是0-99之间:
              // 1. 如果年份大于当前年份的后两位+20，认为是19xx年
              // 2. 如果年份小于等于当前年份的后两位+20，认为是20xx年
              const threshold = (currentYearLastTwo + 20) % 100;
              fullYear = yearNum > threshold ? 1900 + yearNum : 2000 + yearNum;
            } else {
              return null;
            }

            const date = new Date(fullYear, Number(month) - 1, Number(day));
            if (date.getMonth() === Number(month) - 1 &&
                date.getDate() === Number(day)) {
              return date;
            }
            return null;
          } else if (shortMatch) {
            const [_, month, day] = shortMatch;
            const date = new Date(defaultDate.getFullYear(), Number(month) - 1, Number(day));
            if (date.getMonth() === Number(month) - 1 &&
                date.getDate() === Number(day)) {
              return date;
            }
            return null;
          }
          return null;
        };

        const date = parseDate(options.d, targetDate);
        if (!date) {
          await utils.sendAndRecall(session, 'errors.invalid_date');
          return;
        }
        targetDate = date;
      }

      try {
        const year = targetDate.getFullYear();
        const monthStr = String(targetDate.getMonth() + 1).padStart(2, '0');
        const dayStr = String(targetDate.getDate()).padStart(2, '0');
        const currentDateStr = `${year}-${monthStr}-${dayStr}`;
        const monthDay = `${monthStr}-${dayStr}`;

        if (config.holidayMessages?.[monthDay]) {
          const holidayMessage = session.text(config.holidayMessages[monthDay]);
          const promptMessage = await session.send(holidayMessage + '\n' + session.text('commands.jrrp.messages.prompt'));
          await utils.autoRecall(session, promptMessage);
          const response = await session.prompt(10000);
          if (!response) {
            const message = await session.send(session.text('commands.jrrp.messages.cancel'));
            await utils.autoRecall(session, message);
            return;
          }
        }

        const userNickname = session.username || 'User'
        let luckScore: number
        const userDateSeed = `${session.userId}-${currentDateStr}`

        // 检查是否有绑定的识别码，现在可以正确处理特定日期了
        const specialCode = jrrpSpecial.getSpecialCode(session.userId);
        luckScore = calculateScore(userDateSeed, targetDate, specialCode);

        // 特殊模式下的0分特殊处理
        if (specialCode && luckScore === 0) {
          await session.send(session.text('commands.jrrp.messages.special_mode.zero_prompt'));
          const response = await session.prompt(10000);
          // 只有输入y才继续显示结果
          if (!response || response.toLowerCase() !== 'y') {
            const message = await session.send(session.text('commands.jrrp.messages.cancel'));
            await utils.autoRecall(session, message);
            return;
          }
        }

        // 根据分数范围和特殊值生成对应消息
        let resultText = session.text('commands.jrrp.messages.result', [luckScore, userNickname]);
        if (specialCode) {
          if (luckScore === 100 && jrrpSpecial.isFirst100(session.userId)) {
            jrrpSpecial.markFirst100(session.userId);
            resultText += session.text(config.specialMessages[luckScore]) +
                          '\n' + session.text('commands.jrrp.messages.special_mode.first_100');
          } else if (config.specialMessages && luckScore in config.specialMessages) {
            resultText += session.text(config.specialMessages[luckScore]);
          }
        } else if (config.specialMessages && luckScore in config.specialMessages) {
          resultText += session.text(config.specialMessages[luckScore]);
        }

        if (!config.specialMessages?.[luckScore] && config.rangeMessages) {
          for (const [range, msg] of Object.entries(config.rangeMessages)) {
            const [min, max] = range.split('-').map(Number);
            if (!isNaN(min) && !isNaN(max) && luckScore >= min && luckScore <= max) {
              resultText += session.text(msg);
              break;
            }
          }
        }

        await session.send(resultText);
        return;
      } catch (error) {
        console.error('Daily fortune calculation failed:', error);
        await utils.sendAndRecall(session, 'commands.jrrp.messages.error', []);
        return;
      }
    });

  // 自动点赞定时任务配置
  if (config.enabled && config.list?.length > 0) {
    ctx.cron('0 0 0 * * *', async () => {
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
}

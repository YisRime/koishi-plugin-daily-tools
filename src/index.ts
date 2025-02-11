// 基础依赖导入和插件元数据定义
import { Context, Schema, Random, h } from 'koishi'
import {} from 'koishi-plugin-adapter-onebot'

// 插件元数据定义
export const name = 'daily-tools'
export const inject = {required: ['database']}

// 枚举定义
// JRRP算法类型枚举
export const enum JrrpAlgorithm {
  BASIC = 'basic',
  GAUSSIAN = 'gaussian',
  LINEAR = 'linear'
}

// 睡眠模式类型枚举
export const enum SleepMode {
  STATIC = 'static',
  UNTIL = 'until',
  RANDOM = 'random'
}

// 禁言时长类型枚举
export const enum MuteDurationType {
  STATIC = 'static',
  RANDOM = 'random'
}

// 插件配置接口定义
export interface Config {
  sleep: {
    type: SleepMode
    duration: number
    until: string
    min: number
    max: number
  }
  notifyAccount?: string
  choice?: JrrpAlgorithm
  specialPassword?: string
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

// Schema配置定义
export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    sleep: Schema.object({
      type: Schema.union([
        Schema.const(SleepMode.STATIC),
        Schema.const(SleepMode.UNTIL),
        Schema.const(SleepMode.RANDOM),
      ]).default(SleepMode.STATIC),
      duration: Schema.number().default(8),
      until: Schema.string().default('08:00'),
      min: Schema.number().default(6),
      max: Schema.number().default(10),
    }),
  }).i18n({
    'zh-CN': require('./locales/zh-CN').sleepconfig,
    'en-US': require('./locales/en-US').sleepconfig,
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
    notifyAccount: Schema.string(),
    specialPassword: Schema.string().default('PASSWORD').role('secret'),
    rangeMessages: Schema.dict(String).default({
      '0-10': 'commands.jrrp.messages.range.1',
      '11-19': 'commands.jrrp.messages.range.2',
      '20-39': 'commands.jrrp.messages.range.3',
      '40-49': 'commands.jrrp.messages.range.4',
      '50-64': 'commands.jrrp.messages.range.5',
      '65-89': 'commands.jrrp.messages.range.6',
      '90-97': 'commands.jrrp.messages.range.7',
      '98-100': 'commands.jrrp.messages.range.8'
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

// 配置校验器类
// 用于验证插件配置的合法性
class ConfigValidator {
  constructor(private ctx: Context, private config: Config) {}

  // 验证时间格式是否符合 HH:MM 格式
  private validateTimeFormat(time: string): boolean {
    return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time);
  }

  // 验证睡眠时间配置
  private validateSleepTime(): void {
    if (this.config.sleep.type === SleepMode.UNTIL &&
        !this.validateTimeFormat(this.config.sleep.until)) {
      throw new Error('Invalid sleep end time format');
    }
  }

  // 验证运势消息范围配置
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

  // 执行所有验证
  validate(): void {
    this.validateSleepTime();
    this.validateRangeMessages();
  }
}

// 系统常量定义
// 包含缓存键、超时时间和其他限制
const CONSTANTS = {
  CACHE_KEYS: {
    USER: (platform: string, id: string) => `user:${platform}:${id}`,
    MEMBER_LIST: (platform: string, guildId: string) => `members:${platform}:${guildId}`,
    SCORE: (seed: string, type: string) => `score:${seed}:${type}`,
  },
  TIMEOUTS: {
    PROMPT: 10000,
    AUTO_RECALL: 10000,
    LIKE_DELAY: 500,
  },
  LIMITS: {
    MAX_DAYS_TO_CHECK: 365,
    MAX_CACHE_SIZE: 1000,
  }
};

// 工具函数集合
// 包含各种辅助功能如缓存、自动撤回等
const utils = {
  // 自动撤回消息
  async autoRecall(session, message, delay = CONSTANTS.TIMEOUTS.AUTO_RECALL) {
    if (!message) return;

    const timer = setTimeout(async () => {
      if (Array.isArray(message)) {
        await this.batchProcess(
          message,
          async (msg) => {
            const msgId = typeof msg === 'string' ? msg : msg?.id;
            if (msgId) return session.bot.deleteMessage(session.channelId, msgId)
              .catch(() => null);
          }
        );
      } else {
        const msgId = typeof message === 'string' ? message : message?.id;
        if (msgId) await session.bot.deleteMessage(session.channelId, msgId)
          .catch(() => null);
      }
    }, delay);

    return () => clearTimeout(timer); // 返回取消函数
  },

  // 缓存配置
  cacheConfig: {
    userNameExpiry: 3600000,
    memberListExpiry: 3600000,
    scoreExpiry: 86400000,
  },

  // 用户名缓存系统
  userCache: new Map<string, {name: string, expiry: number}>(),
  async getUserName(ctx: Context, session, userId: string) {
    const cacheKey = `${session.platform}:${userId}`;
    const now = Date.now();
    const cached = this.userCache.get(cacheKey);

    if (cached && cached.expiry > now) {
      return cached.name;
    }

    const user = await ctx.database.getUser(session.platform, userId);
    const name = user?.name || userId;
    this.userCache.set(cacheKey, {
      name,
      expiry: now + this.cacheConfig.userNameExpiry
    });
    return name;
  },

  // 群成员列表缓存系统
  memberListCache: new Map<string, {
    members: string[],
    expiry: number
  }>(),

  async getCachedMemberList(session): Promise<string[]> {
    const cacheKey = `${session.platform}:${session.guildId}`;
    const now = Date.now();
    const cached = this.memberListCache.get(cacheKey);

    if (cached && cached.expiry > now) {
      return cached.members;
    }

    const members = await session.onebot.getGroupMemberList(session.guildId);
    const validMembers = members
      .filter(m => m.role === 'member' && String(m.user_id) !== String(session.selfId))
      .map(m => String(m.user_id));

    this.memberListCache.set(cacheKey, {
      members: validMembers,
      expiry: now + this.cacheConfig.memberListExpiry
    });

    return validMembers;
  },

  // 运势分数缓存系统
  scoreCache: new Map<string, {
    score: number,
    expiry: number
  }>(),

  getCachedScore(key: string): number | null {
    const cached = this.scoreCache.get(key);
    if (cached && cached.expiry > Date.now()) {
      return cached.score;
    }
    return null;
  },

  setCachedScore(key: string, score: number): void {
    this.scoreCache.set(key, {
      score,
      expiry: Date.now() + this.cacheConfig.scoreExpiry
    });
  },

  // 定期清理过期缓存
  startCacheCleaner(interval = 21600000) {
    setInterval(() => {
      const now = Date.now();

      // 清理用户名缓存
      for (const [key, value] of this.userCache.entries()) {
        if (value.expiry <= now) this.userCache.delete(key);
      }

      // 清理群成员列表缓存
      for (const [key, value] of this.memberListCache.entries()) {
        if (value.expiry <= now) this.memberListCache.delete(key);
      }

      // 清理运势分数缓存
      for (const [key, value] of this.scoreCache.entries()) {
        if (value.expiry <= now) this.scoreCache.delete(key);
      }
    }, interval);
  },

  hashCode(str: string): number {
    let hash = 5381;
    for (let i = 0; str.length > i; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash >>> 0;
    }
    return hash;
  },

  // 添加LRU缓存控制
  trimCache(cache: Map<any, any>, maxSize = CONSTANTS.LIMITS.MAX_CACHE_SIZE) {
    if (cache.size > maxSize) {
      const entriesToDelete = Array.from(cache.keys())
        .slice(0, cache.size - maxSize);
      entriesToDelete.forEach(key => cache.delete(key));
    }
  },

  // 优化缓存设置方法
  setCacheValue<T>(cache: Map<string, {value: T, expiry: number}>, key: string, value: T, expiry: number) {
    cache.set(key, {value, expiry});
    this.trimCache(cache);
  },

  // 批量操作工具方法
  async batchProcess<T>(items: T[], processor: (item: T) => Promise<any>, batchSize = 5) {
    const results = [];
    for (let i = 0; items.length > i; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(processor));
      results.push(...batchResults);
    }
    return results;
  },

  // 错误处理增强
  async safeExecute<T>(
    operation: () => Promise<T>,
    errorHandler: (error: Error) => Promise<void> | void,
    defaultValue?: T
  ): Promise<T | undefined> {
    try {
      return await operation();
    } catch (error) {
      await errorHandler(error as Error);
      return defaultValue;
    }
  },
};

// 特殊模式处理类
// 处理JRRP特殊码相关功能
class JrrpSpecialMode {
  private specialCodes = new Map<string, string>();
  private first100Records = new Map<string, boolean>();
  private readonly JRRP_DATA_PATH = 'data/jrrp.json';

  constructor(private ctx: Context) {
    this.loadData();
  }

  private getDayOfYear(date: Date): number {
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date.getTime() - start.getTime();
    const oneDay = 1000 * 60 * 60 * 24;
    return Math.floor(diff / oneDay);
  }

  private getHash(str: string): bigint {
    let hash = BigInt(5381);
    for (let i = 0; str.length > i; i++) {
      hash = ((hash << BigInt(5)) ^ hash ^ BigInt(str.charCodeAt(i))) & ((BigInt(1) << BigInt(64)) - BigInt(1));
    }
    return hash ^ BigInt('0xa98f501bc684032f');
  }

  private async loadData(): Promise<void> {
    return utils.safeExecute(
      async () => {
        const fs = require('fs').promises;
        try {
          const exists = await fs.access(this.JRRP_DATA_PATH)
            .then(() => true)
            .catch(() => false);

          if (exists) {
            const data = JSON.parse(await fs.readFile(this.JRRP_DATA_PATH, 'utf8'));
            if (data.codes) {
              Object.entries(data.codes).forEach(([userId, code]) => {
                this.specialCodes.set(userId, code as string);
              });
            }
            if (data.first100) {
              Object.entries(data.first100).forEach(([userId, hadFirst100]) => {
                this.first100Records.set(userId, hadFirst100 as boolean);
              });
            }
          }
        } catch (error) {
          this.ctx.logger.error('Failed to load JRRP data:', error);
        }
      },
      (error) => this.ctx.logger.error('Failed to load JRRP data:', error)
    );
  }

  private async saveData(): Promise<void> {
    try {
      const fs = require('fs').promises;
      // 确保目录存在
      const dir = require('path').dirname(this.JRRP_DATA_PATH);
      await fs.mkdir(dir, { recursive: true });

      const data = {
        codes: Object.fromEntries(this.specialCodes),
        first100: Object.fromEntries(this.first100Records)
      };
      await fs.writeFile(this.JRRP_DATA_PATH, JSON.stringify(data, null, 2));
    } catch (error) {
      this.ctx.logger.error('Failed to save JRRP data:', error);
    }
  }

  async markFirst100(userId: string): Promise<void> {
    this.first100Records.set(userId, true);
    await this.saveData();
  }

  isFirst100(userId: string): boolean {
    return !this.first100Records.get(userId);
  }

  validateSpecialCode(code: string): boolean {
    return /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/i.test(code);
  }

  async bindSpecialCode(userId: string, code: string): Promise<void> {
    this.specialCodes.set(userId, code.toUpperCase());
    await this.saveData();
  }

  async removeSpecialCode(userId: string): Promise<void> {
    this.specialCodes.delete(userId);
    await this.saveData();
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

  // 添加批量处理方法
  async batchLoadData(data: Record<string, any>) {
    const operations = [];

    if (data.codes) {
      operations.push(...Object.entries(data.codes)
        .map(([userId, code]) =>
          this.specialCodes.set(userId, code as string)));
    }

    if (data.first100) {
      operations.push(...Object.entries(data.first100)
        .map(([userId, hadFirst100]) =>
          this.first100Records.set(userId, hadFirst100 as boolean)));
    }

    await Promise.all(operations);
  }
}

// 禁言处理函数
// 处理禁言操作并发送相关通知
async function handleMute(session, targetId: string, duration: number, config: Config) {
  try {
    await session.onebot.setGroupBan(session.guildId, targetId, duration);

    if (session.messageId) {
      try {
        await session.bot.deleteMessage(session.channelId, session.messageId);
      } catch {}
    }

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

// 插件应用函数
// 注册命令和处理逻辑
export async function apply(ctx: Context, config: Config) {
  // 初始化配置验证
  try {
    new ConfigValidator(ctx, config).validate();
  } catch (error) {
    ctx.logger.error('Configuration validation failed:', error.message);
    throw error;
  }

  ctx.i18n.define('zh-CN', require('./locales/zh-CN'));
  ctx.i18n.define('en-US', require('./locales/en-US'));

  const jrrpSpecial = new JrrpSpecialMode(ctx);

  // 启动缓存清理器
  utils.startCacheCleaner();

  // 修改calculateScore函数以使用缓存
  function calculateScore(userDateSeed: string, date: Date, specialCode: string | undefined): number {
    const cacheKey = `score:${userDateSeed}:${specialCode || 'normal'}`;
    const cachedScore = utils.getCachedScore(cacheKey);
    if (cachedScore !== null) {
      return cachedScore;
    }

    let score: number;
    if (specialCode) {
      score = jrrpSpecial.calculateSpecialJrrp(specialCode, date, config.specialPassword);
    } else {
      switch (config.choice) {
        case 'basic': {
          score = Math.abs(utils.hashCode(userDateSeed)) % 101;
          break;
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
          score = toNormalLuck(weightedRandom);
          break;
        }
        case 'linear': {
          const lcgSeed = utils.hashCode(userDateSeed);
          score = Math.floor(((lcgSeed * 9301 + 49297) % 233280) / 233280 * 101);
          break;
        }
        default: {
          score = Math.abs(utils.hashCode(userDateSeed)) % 101;
          break;
        }
      }
    }

    utils.setCachedScore(cacheKey, score);
    return score;
  }

  // 添加性能监控
  const perfMonitor = {
    startTime: 0,
    logPerformance(operation: string) {
      const duration = Date.now() - this.startTime;
      if (duration > 100) { // 仅记录耗时超过100ms的操作
        ctx.logger.debug(`Performance: ${operation} took ${duration}ms`);
      }
    },
    start() {
      this.startTime = Date.now();
    }
  };

  // 在关键操作处使用性能监控
  async function monitoredCalculateScore(userDateSeed: string, date: Date, specialCode: string | undefined): Promise<number> {
    perfMonitor.start();
    const result = calculateScore(userDateSeed, date, specialCode);
    perfMonitor.logPerformance('calculateScore');
    return result;
  }

  // 精致睡眠命令
  ctx.command('sleep')
    .alias('jzsm', '精致睡眠')
    .channelFields(['guildId'])
    .action(async ({ session }) => {
      try {
        let duration: number;
        const now = new Date();
        const sleep = config.sleep;

        switch (sleep.type) {
          case 'static':
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
            const min = Math.max(1, sleep.min) * 60;
            const max = Math.max(sleep.max, sleep.min) * 60;
            duration = Math.floor(Math.random() * (max - min + 1) + min);
            break;
        }

        await session.bot.muteGuildMember(session.guildId, session.userId, duration * 60 * 1000);
        return session.text('commands.sleep.messages.success');
      } catch (error) {
        const message = await session.send(session.text('commands.sleep.messages.failed'));
        await utils.autoRecall(session, message);
        return;
      }
    });

  // 点赞命令
  ctx.command('zanwo')
    .alias('赞我')
    .option('u', '-u <target:text>')
    .action(async ({ session, options }) => {
      let targetId = session.userId;
      if (options?.u) {
        const parsedUser = h.parse(options.u)[0];
        targetId = parsedUser?.type === 'at' ? parsedUser.attrs.id : options.u.trim();

        if (!targetId) {
          const message = await session.send(session.text('commands.zanwo.messages.target_not_found'));
          await utils.autoRecall(session, message);
          return;
        }
      }

      try {
        await Promise.all([
          ...Array(5).fill(null).map(() =>
            session.bot.internal.sendLike(targetId, 10).catch(() => null)
          ),
          new Promise(resolve => setTimeout(resolve, CONSTANTS.TIMEOUTS.LIKE_DELAY)) // 添加延迟防止请求过快
        ]);
        const message = await session.send(session.text('commands.zanwo.messages.success', [config.notifyAccount || '']));
        await utils.autoRecall(session, message);
        return;
      } catch {
        const message = await session.send(session.text('commands.zanwo.messages.like_failed'));
        await utils.autoRecall(session, message);
        return;
      }
    });

  // 禁言命令处理
  ctx.command('mute [duration:number]')
    .channelFields(['guildId'])
    .option('u', '-u <target:text>') // 指定目标用户选项
    .option('r', '-r')              // 随机选择目标选项
    .action(async ({ session, options }, duration) => {
      // 检查是否允许禁言他人
      if (!config.mute.enableMuteOthers && (options?.u || options?.r)) {
        const message = await session.send(session.text('commands.mute.messages.notify.others_disabled'));
        await utils.autoRecall(session, message);
        return;
      }

      // 验证禁言时长是否超过最大限制
      if (duration && duration > config.mute.maxAllowedDuration) {
        const message = await session.send(session.text('commands.mute.messages.errors.duration_too_long', [config.mute.maxAllowedDuration]));
        await utils.autoRecall(session, message);
        return;
      }

      // 计算实际禁言时长
      let random = new Random();
      let muteDuration = duration ? duration * 60  // 指定时长
        : config.mute.type === MuteDurationType.RANDOM
          ? random.int(config.mute.minDuration * 60, config.mute.maxDuration * 60) // 随机时长
          : config.mute.duration * 60; // 默认时长

      // 处理随机禁言模式
      if (options?.r) {
        try {
          // 获取有效群成员列表
          const validMembers = await utils.getCachedMemberList(session);
          if (!validMembers.length) {
            const message = await session.send(session.text('commands.mute.messages.no_valid_members'));
            await utils.autoRecall(session, message);
            return;
          }

          // 根据概率决定是禁言自己还是他人
          if (!random.bool(config.mute.probability)) {
            await handleMute(session, session.userId, muteDuration, config);
            return;
          }

          // 随机选择目标并执行禁言
          const targetIndex = random.int(0, validMembers.length - 1);
          await handleMute(session, validMembers[targetIndex], muteDuration, config);
          return;
        } catch {
          const message = await session.send(session.text('commands.mute.messages.no_valid_members'));
          await utils.autoRecall(session, message);
          return;
        }
      }

      // 处理指定目标禁言模式
      if (options?.u) {
        const parsedUser = h.parse(options.u)[0];
        const targetId = parsedUser?.type === 'at' ? parsedUser.attrs.id : options.u.trim();

        // 如果目标无效或是自己，则禁言自己
        if (!targetId || targetId === session.userId) {
          await handleMute(session, session.userId, muteDuration, config);
          return;
        }

        // 根据概率决定是禁言自己还是目标
        if (!random.bool(config.mute.probability)) {
          await handleMute(session, session.userId, muteDuration, config);
          return;
        }

        await handleMute(session, targetId, muteDuration, config);
        return;
      }

      // 默认禁言自己
      await handleMute(session, session.userId, muteDuration, config);
    });

  // 今日人品命令处理
  ctx.command('jrrp')
    .option('d', '-d <date>', { type: 'string' })
    .option('b', '-b <code>', { type: 'string' })
    .option('g', '-g <number:number>', { fallback: 100 })
    .action(async ({ session, options }) => {
      // 处理查找特定分数的日期
      if ('g' in options && options.g !== null) {
        // 验证分数范围
        if (options.g < 0 || options.g > 100) {
          const message = await session.send(session.text('commands.jrrp.messages.invalid_number'));
          await utils.autoRecall(session, message);
          return;
        }

        const currentDate = new Date();
        const targetScore = options.g;
        const specialCode = jrrpSpecial.getSpecialCode(session.userId);

        for (let i = 1; i <= CONSTANTS.LIMITS.MAX_DAYS_TO_CHECK; i++) {
          const checkDate = new Date(currentDate);
          checkDate.setDate(currentDate.getDate() + i);

          const dateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
          const userDateSeed = `${session.userId}-${dateStr}`;
          const score = await monitoredCalculateScore(userDateSeed, checkDate, specialCode);

          if (score === targetScore) {
            const formattedDate = `${checkDate.getFullYear().toString().slice(-2)}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
            // 移除自动撤回
            await session.send(session.text('commands.jrrp.messages.found_date', [targetScore, formattedDate]));
            return;
          }
        }

        // 移除自动撤回
        await session.send(session.text('commands.jrrp.messages.not_found', [targetScore]));
        return;
      }

      // 处理特殊码绑定
      if ('b' in options) {
        try {
          // 删除原始命令消息
          if (session.messageId) {
            await session.bot.deleteMessage(session.channelId, session.messageId);
          }

          // 处理解绑操作
          if (!options.b) {
            const message = await session.send(session.text('commands.jrrp.messages.special_mode.unbind_success'));
            await utils.autoRecall(session, message);
            await jrrpSpecial.removeSpecialCode(session.userId);
            return;
          }

          // 验证特殊码格式
          if (!jrrpSpecial.validateSpecialCode(options.b)) {
            const message = await session.send(session.text('commands.jrrp.messages.special_mode.invalid_code'));
            await utils.autoRecall(session, message);
            return;
          }

          // 绑定特殊码
          const message = await session.send(session.text('commands.jrrp.messages.special_mode.bind_success'));
          await utils.autoRecall(session, message);
          await jrrpSpecial.bindSpecialCode(session.userId, options.b);
          return;
        } catch (e) {
          console.error('Failed to handle special code binding:', e);
        }
      }

      // 处理日期解析
      let targetDate = new Date();
      if (options?.d) {
        const parseDate = (dateStr: string, defaultDate: Date): Date | null => {
          // 标准化日期字符串
          const normalizedDate = dateStr.replace(/[\s.\/]/g, '-').replace(/-+/g, '-');

          // 匹配不同的日期格式
          const fullMatch = normalizedDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
          const shortYearMatch = normalizedDate.match(/^(\d{1,2})-(\d{1,2})-(\d{1,2})$/);
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
            let fullYear: number;
            const yearNum = Number(year);
            const currentYear = defaultDate.getFullYear();
            const currentYearLastTwo = currentYear % 100;

            if (yearNum >= 0 && yearNum <= 99) {
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

        // 解析日期并验证
        const date = parseDate(options.d, targetDate);
        if (!date) {
          const message = await session.send(session.text('errors.invalid_date'));
          await utils.autoRecall(session, message);
          return;
        }
        targetDate = date;
      }

      // 计算运势
      try {
        // 格式化日期字符串
        const year = targetDate.getFullYear();
        const monthStr = String(targetDate.getMonth() + 1).padStart(2, '0');
        const dayStr = String(targetDate.getDate()).padStart(2, '0');
        const currentDateStr = `${year}-${monthStr}-${dayStr}`;
        const monthDay = `${monthStr}-${dayStr}`;

        // 处理节日特殊消息
        if (config.holidayMessages?.[monthDay]) {
          const holidayMessage = session.text(config.holidayMessages[monthDay]);
          const promptMessage = await session.send(holidayMessage + '\n' + session.text('commands.jrrp.messages.prompt'));
          await utils.autoRecall(session, promptMessage);
          const response = await session.prompt(CONSTANTS.TIMEOUTS.PROMPT);
          if (!response) {
            // 移除自动撤回
            await session.send(session.text('commands.jrrp.messages.cancel'));
            return;
          }
        }

        const userNickname = session.username || 'User'
        let luckScore: number
        const userDateSeed = `${session.userId}-${currentDateStr}`

        const specialCode = jrrpSpecial.getSpecialCode(session.userId);
        luckScore = await monitoredCalculateScore(userDateSeed, targetDate, specialCode);

        // 处理特殊码零分确认
        if (specialCode && luckScore === 0) {
          await session.send(session.text('commands.jrrp.messages.special_mode.zero_prompt'));
          const response = await session.prompt(CONSTANTS.TIMEOUTS.PROMPT);
          if (!response || response.toLowerCase() !== 'y') {
            const message = await session.send(session.text('commands.jrrp.messages.cancel'));
            await utils.autoRecall(session, message);
            return;
          }
        }

        // 构建结果消息
        let resultText = session.text('commands.jrrp.messages.result', [luckScore, userNickname]);

        // 处理特殊分数消息
        if (specialCode) {
          if (luckScore === 100 && jrrpSpecial.isFirst100(session.userId)) {
            await jrrpSpecial.markFirst100(session.userId);
            resultText += session.text(config.specialMessages[luckScore]) +
                          '\n' + session.text('commands.jrrp.messages.special_mode.first_100');
          } else if (config.specialMessages && luckScore in config.specialMessages) {
            resultText += session.text(config.specialMessages[luckScore]);
          }
        } else if (config.specialMessages && luckScore in config.specialMessages) {
          resultText += session.text(config.specialMessages[luckScore]);
        }

        // 处理分数范围消息
        if (!config.specialMessages?.[luckScore] && config.rangeMessages) {
          for (const [range, msg] of Object.entries(config.rangeMessages)) {
            const [min, max] = range.split('-').map(Number);
            if (!isNaN(min) && !isNaN(max) && luckScore >= min && luckScore <= max) {
              resultText += session.text(msg);
              break;
            }
          }
        }

        // 发送结果
        await session.send(resultText);
        return;
      } catch (error) {
        console.error('Daily fortune calculation failed:', error);
        const message = await session.send(session.text('commands.jrrp.messages.error', []));
        await utils.autoRecall(session, message);
        return;
      }
    });
}

// 基础依赖导入和插件元数据定义
import { Context, Schema, Random} from 'koishi'
import {} from 'koishi-plugin-adapter-onebot'
import { ZanwoManager } from './utils/ZanwoManager'
import { ConfigValidator } from './utils/ConfigValidator'
import { JrrpIdentificationMode } from './utils/JrrpIdentificationMode'
import * as utils from './utils/utils'
import { CONSTANTS } from './utils/utils'

// 插件元数据定义
export const name = 'daily-tools'
export const inject = {required: ['database']}

/**
 * 睡眠模式类型枚举
 * @enum {string}
 */
export const enum SleepMode {
  STATIC = 'static',
  UNTIL = 'until',
  RANDOM = 'random'
}

/**
 * 禁言时长类型枚举
 * @enum {string}
 */
export const enum MuteDurationType {
  STATIC = 'static',
  RANDOM = 'random'
}

/**
 * JRRP算法类型枚举
 * @enum {string}
 */
export const enum JrrpAlgorithm {
  BASIC = 'basic',
  GAUSSIAN = 'gaussian',
  LINEAR = 'linear'
}

/**
 * 娱乐模式类型枚举
 * @enum {string}
 */
export const enum FoolMode {
  DISABLED = 'disabled',
  ENABLED = 'enabled'
}

/**
 * 显示模式类型枚举
 * @enum {string}
 */
export const enum DisplayMode {
  BINARY = 'binary',
  EXPRESSION = 'expression'
}

/**
 * 插件配置接口
 */
export interface SleepConfig {
  type: SleepMode
  duration?: number // static模式
  until?: string   // until模式
  min?: number     // random模式
  max?: number     // random模式
}

export interface MuteConfig {
  type: MuteDurationType
  duration?: number // static模式
  min?: number     // random模式
  max?: number     // random模式
}

export interface FoolConfig {
  type: FoolMode
  date?: string
  displayMode?: DisplayMode
  baseNumber?: number // expression模式专用
}

export interface Config {
  // autolike相关
  adminAccount?: string
  enableNotify?: boolean
  adminOnly?: boolean

  // mute相关
  sleep: SleepConfig
  mute: MuteConfig
  maxAllowedDuration: number
  enableMessage: boolean
  enableMuteOthers: boolean
  probability: number

  // jrrp相关
  choice: JrrpAlgorithm
  identificationCode: string // 改名:specialCode -> identificationCode
  fool: FoolConfig
  rangeMessages?: Record<string, string>
  specialMessages?: Record<number, string>
  holidayMessages?: Record<string, string>
}

// Schema配置定义
export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    adminAccount: Schema.string(),
    enableNotify: Schema.boolean().default(true),
    adminOnly: Schema.boolean().default(true),
  }).i18n({
    'zh-CN': require('./locales/zh-CN').config_autolike,
    'en-US': require('./locales/en-US').config_autolike,
  }),

  Schema.object({
    sleep: Schema.intersect([
      Schema.object({
        type: Schema.union([SleepMode.STATIC, SleepMode.UNTIL, SleepMode.RANDOM]),
      }).default({ type: SleepMode.STATIC }),
      Schema.union([
        Schema.object({
          type: Schema.const(SleepMode.STATIC).required(),
          duration: Schema.number().default(8),
        }),
        Schema.object({
          type: Schema.const(SleepMode.UNTIL).required(),
          until: Schema.string().default('08:00'),
        }),
        Schema.object({
          type: Schema.const(SleepMode.RANDOM).required(),
          min: Schema.number().default(6),
          max: Schema.number().default(10),
        }),
      ]),
    ]),
    mute: Schema.intersect([
      Schema.object({
        type: Schema.union([MuteDurationType.STATIC, MuteDurationType.RANDOM]),
      }).default({ type: MuteDurationType.STATIC }),
      Schema.union([
        Schema.object({
          type: Schema.const(MuteDurationType.STATIC).required(),
          duration: Schema.number().default(5),
        }),
        Schema.object({
          type: Schema.const(MuteDurationType.RANDOM).required(),
          min: Schema.number().default(0.1),
          max: Schema.number().default(10),
        }),
      ]),
    ]),
    maxAllowedDuration: Schema.number().default(1440),
    enableMessage: Schema.boolean().default(false),
    enableMuteOthers: Schema.boolean().default(true),
    probability: Schema.number().default(0.5).min(0).max(1),
  }).i18n({
    'zh-CN': require('./locales/zh-CN').config_mute,
    'en-US': require('./locales/zh-CN').config_mute,
  }),

  Schema.object({
    choice: Schema.union([
      Schema.const(JrrpAlgorithm.BASIC),
      Schema.const(JrrpAlgorithm.GAUSSIAN),
      Schema.const(JrrpAlgorithm.LINEAR),
    ]).default(JrrpAlgorithm.BASIC),
    identificationCode: Schema.string().default('CODE').role('secret'), // 改名
    fool: Schema.intersect([
      Schema.object({
        type: Schema.union([FoolMode.DISABLED, FoolMode.ENABLED]),
      }).default({ type: FoolMode.DISABLED }),
      Schema.union([
        Schema.object({
          type: Schema.const(FoolMode.DISABLED),
        }),
        Schema.intersect([
          Schema.object({
            type: Schema.const(FoolMode.ENABLED).required(),
            date: Schema.string().default('4-1'),
          }),
          Schema.intersect([
            Schema.object({
              displayMode: Schema.union([DisplayMode.BINARY, DisplayMode.EXPRESSION]),
            }).default({ displayMode: DisplayMode.BINARY }),
            Schema.union([
              Schema.object({
                displayMode: Schema.const(DisplayMode.BINARY),
              }),
              Schema.object({
                displayMode: Schema.const(DisplayMode.EXPRESSION).required(),
                baseNumber: Schema.number().default(6).min(0).max(9),
              }),
            ]),
          ]),
        ]),
      ]),
    ]),
  }).i18n({
    'zh-CN': require('./locales/zh-CN').config_jrrp,
    'en-US': require('./locales/en-US').config_jrrp,
  }),
  Schema.object({
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
    'zh-CN': require('./locales/zh-CN').config_range,
    'en-US': require('./locales/en-US').config_range,
  }),
])

/**
 * 插件主函数
 * @param {Context} ctx - Koishi 上下文
 * @param {Config} config - 插件配置
 */
export async function apply(ctx: Context, config: Config) {
  new ConfigValidator(config).validate();

  ctx.i18n.define('zh-CN', require('./locales/zh-CN'));
  ctx.i18n.define('en-US', require('./locales/en-US'));

  const jrrpIdentification = new JrrpIdentificationMode(ctx);
  utils.startCacheCleaner();
  const zanwoManager = new ZanwoManager(ctx);

  /**
   * 计算用户的运势分数
   * @description
   * 支持三种算法模式:
   * 1. basic - 基础哈希取模算法
   * 2. gaussian - 高斯分布算法,生成更符合正态分布的分数
   * 3. linear - 线性同余算法,生成均匀分布的分数
   *
   * 特殊代码模式下使用独立的计算逻辑
   * 结果会被缓存以提高性能
   */
  function calculateScore(userDateSeed: string, date: Date, identificationCode: string | undefined): number {
    const cacheKey = `score:${userDateSeed}:${identificationCode || 'normal'}`;
    const cachedScore = utils.getCachedScore(cacheKey);
    if (cachedScore !== null) {
      return cachedScore;
    }

    let score: number;
    if (identificationCode) {
      score = jrrpIdentification.calculateJrrpWithCode(identificationCode, date, config.identificationCode);
    } else {
      switch (config.choice) {
        case JrrpAlgorithm.BASIC: {
          // 基础算法:对用户ID+日期的哈希值取模
          score = Math.abs(utils.hashCode(userDateSeed)) % 101;
          break;
        }
        case JrrpAlgorithm.GAUSSIAN: {
          // 高斯算法:使用Box-Muller变换生成正态分布随机数
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
        case JrrpAlgorithm.LINEAR: {
          // 线性同余算法:使用线性同余生成器
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

  /**
   * 精致睡眠命令处理
   * @description
   * 三种睡眠模式:
   * 1. static - 固定时长,使用配置的duration
   * 2. until - 指定时间,计算到指定时间的时长
   * 3. random - 随机时长,在min和max之间随机
   *
   * 所有模式都确保至少1分钟的禁言时长
   */
  ctx.command('sleep')
    .alias('jzsm', '精致睡眠')
    .channelFields(['guildId'])
    .action(async ({ session }) => {
      try {
        let duration: number;
        const now = new Date();
        const sleep = config.sleep;

        switch (sleep.type) {
          case SleepMode.STATIC:
            duration = Math.max(1, sleep.duration) * 60;
            break;
          case SleepMode.UNTIL:
            const [hours, minutes] = sleep.until.split(':').map(Number);
            if (isNaN(hours) || isNaN(minutes)) {
              throw new Error(session.text('commands.sleep.errors.invalid_time'));
            }
            const endTime = new Date(now);
            endTime.setHours(hours, minutes, 0, 0);
            if (endTime <= now) endTime.setDate(endTime.getDate() + 1);
            duration = Math.max(1, Math.floor((endTime.getTime() - now.getTime()) / 60000));
            break;
          case SleepMode.RANDOM:
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

  /**
   * 点赞命令处理
   * @description
   * 支持以下功能:
   * 1. -l 查看点赞目标列表
   * 2. -a/-r 添加/移除点赞目标(仅管理员)
   * 3. -z 批量点赞所有目标
   * 4. -u 指定目标点赞
   * 5. 无参数时点赞自己
   *
   * 所有操作都有对应的成功/失败提示
   */
  ctx.command('zanwo')
    .alias('赞我')
    .option('u', '-u <target:text>')
    .option('a', '-a <target:text>')
    .option('r', '-r <target:text>')
    .option('z', '-z')
    .option('l', '-l')
    .action(async ({ session, options }) => {
      // 列表查看功能
      if (options?.l) {
        const targets = zanwoManager.getList();
        if (!targets.length) {
          return session.text('commands.zanwo.messages.no_targets');
        }

        return session.text('commands.zanwo.messages.list', [targets.join(', ')]);
      }

      // 列表管理操作
      if (options?.a || options?.r) {
        // 检查管理员权限
        if (config.adminOnly && session.userId !== config.adminAccount) {
          return session.send(session.text('commands.zanwo.messages.permission_denied'));
        }

        const operation = options.a ? 'add' : 'remove';
        const targetRaw = options.a || options.r;

        const target = utils.parseTarget(targetRaw);
        if (!target) {
          return session.send(session.text('commands.zanwo.messages.target_not_found'));
        }

        const success = await zanwoManager[operation === 'add' ? 'addQQ' : 'removeQQ'](target);
        return session.send(
          session.text(`commands.zanwo.messages.${operation}_${success ? 'success' : 'failed'}`, [target])
        );
      }

      // 批量点赞
      if (options?.z) {
        const targets = zanwoManager.getList();
        if (!targets.length) {
          const message = await session.send(session.text('commands.zanwo.messages.no_targets'));
          await utils.autoRecall(session, message);
          return;
        }

        const results = await zanwoManager.sendBatchLikes(session, targets);
        const successCount = Array.from(results.values()).filter(Boolean).length;
        const success = successCount === targets.length;

        const message = await session.send(
          session.text(`commands.zanwo.messages.batch_${success ? 'success' : 'failed'}`)
        );
        await utils.autoRecall(session, message);
        return;
      }

      // 单个点赞
      const likeTargetId = utils.parseTarget(options.u) || session.userId;
      if (options?.u) {
        if (likeTargetId === session.userId) {
          const message = await session.send(session.text('commands.zanwo.messages.target_not_found'));
          await utils.autoRecall(session, message);
          return;
        }
      }

      const success = await zanwoManager.sendLikes(session, likeTargetId);
      const message = await session.send(
        success
          ? session.text('commands.zanwo.messages.success', [config.enableNotify ? (config.adminAccount || '') : ''])
          : session.text('commands.zanwo.messages.like_failed')
      );
      await utils.autoRecall(session, message);
    });

  /**
   * 禁言命令处理
   * @description
   * 支持以下功能:
   * 1. 指定时长禁言,[duration]参数
   * 2. -u 指定目标禁言
   * 3. -r 随机选择目标禁言
   *
   * 特殊处理:
   * 1. 概率判定是否禁言自己
   * 2. 目标无效时默认禁言自己
   * 3. 随机时长在配置范围内
   * 4. 支持禁言消息提示
   */
  ctx.command('mute [duration:number]')
    .channelFields(['guildId'])
    .option('u', '-u <target:text>')
    .option('r', '-r')
    .action(async ({ session, options }, duration) => {
      // 检查是否允许禁言他人
      if (!config.enableMuteOthers && (options?.u || options?.r)) {
        const message = await session.send(session.text('commands.mute.messages.notify.others_disabled'));
        await utils.autoRecall(session, message);
        return;
      }

      // 验证禁言时长是否超过最大限制
      if (duration && duration > config.maxAllowedDuration) {
        const message = await session.send(session.text('commands.mute.messages.errors.duration_too_long', [config.maxAllowedDuration]));
        await utils.autoRecall(session, message);
        return;
      }

      // 计算实际禁言时长
      let randomGenerator = new Random();
      let muteDuration: number;

      if (duration) {
        muteDuration = duration * 60;  // 指定时长
      } else {
        switch (config.mute.type) {
          case MuteDurationType.STATIC:
            muteDuration = config.mute.duration * 60;
            break;
          case MuteDurationType.RANDOM:
            muteDuration = randomGenerator.int(config.mute.min * 60, config.mute.max * 60);
            break;
          default:
            muteDuration = 5 * 60; // 默认5分钟
        }
      }

      // 处理随机禁言模式
      if (options?.r) {
        try {
          const validMembers = await utils.getCachedMemberList(session);
          if (!validMembers.length) {
            const message = await session.send(session.text('commands.mute.messages.errors.no_valid_members'));
            await utils.autoRecall(session, message);
            return;
          }

          if (!randomGenerator.bool(config.probability)) {
            await utils.executeMute(session, session.userId, muteDuration, config.enableMessage);
            return;
          }

          // 随机选择目标并执行禁言
          const targetIndex = randomGenerator.int(0, validMembers.length - 1);
          const targetId = validMembers[targetIndex];
          await utils.executeMute(session, targetId, muteDuration, config.enableMessage);
          return;
        } catch (error) {
          console.error('Failed to execute random mute:', error);
          const message = await session.send(session.text('commands.mute.messages.errors.no_valid_members'));
          await utils.autoRecall(session, message);
          return;
        }
      }

      // 处理指定目标禁言模式
      const muteTargetId = utils.parseTarget(options.u);
      if (options?.u) {
        // 如果目标无效或是自己，则禁言自己
        if (!muteTargetId || muteTargetId === session.userId) {
          await utils.executeMute(session, session.userId, muteDuration, config.enableMessage);
          return;
        }

        // 根据概率决定是禁言自己还是目标
        if (!randomGenerator.bool(config.probability)) {
          await utils.executeMute(session, session.userId, muteDuration, config.enableMessage);
          return;
        }

        await utils.executeMute(session, muteTargetId, muteDuration, config.enableMessage);
        return;
      }

      // 默认禁言自己
      await utils.executeMute(session, session.userId, muteDuration, config.enableMessage);
    });

  /**
   * 今日人品命令处理
   * @description
   * 支持以下功能:
   * 1. -d 指定日期查询
   * 2. -b 特殊代码绑定/解绑
   * 3. -g 查找特定分数的日期
   *
   * 特殊处理:
   * 1. 节日特殊消息
   * 2. 特殊代码零分确认
   * 3. 首次100分特殊提示
   * 4. 分数范围和特殊分数消息
   * 5. 支持分数显示格式化
   */
  ctx.command('jrrp')
    .option('d', '-d <date:string>', { fallback: null })
    .option('g', '-g <score:integer>', { fallback: null })
    .option('b', '-b [code:string]', { fallback: null })
    .action(async ({ session, options }) => {
      // 处理识别码绑定
      if ('b' in options) {
          try {
            // 尝试删除原始命令消息
            if (session.messageId) {
              await utils.autoRecall(session, session.messageId, 500);
            }

            // 处理解绑
            if (!options.b) {
              await jrrpIdentification.removeIdentificationCode(session.userId);
              const message = await session.send(session.text('commands.jrrp.messages.special_mode.unbind_success'));
              await utils.autoRecall(session, message);
              return;
            }

            // 处理绑定
            const code = options.b.trim().toUpperCase();

            // 格式验证
            if (!code || !jrrpIdentification.validateIdentificationCode(code)) {
              const message = await session.send(session.text('commands.jrrp.messages.special_mode.invalid_code'));
              await utils.autoRecall(session, message);
              return;
            }

            const existingCode = await jrrpIdentification.getIdentificationCode(session.userId);

            // 检查重复绑定
            if (existingCode === code) {
              const message = await session.send(session.text('commands.jrrp.messages.special_mode.already_bound'));
              await utils.autoRecall(session, message);
              return;
            }

            // 执行绑定
            await jrrpIdentification.bindIdentificationCode(session.userId, code);
            const message = await session.send(session.text(
              existingCode ? 'commands.jrrp.messages.special_mode.rebind_success' : 'commands.jrrp.messages.special_mode.bind_success'
            ));
            await utils.autoRecall(session, message);
            return;
          } catch (error) {
            console.error('Failed to handle identification code:', error);
            const message = await session.send(session.text('commands.jrrp.messages.error'));
            await utils.autoRecall(session, message);
            return;
          }
      }

      // 处理查找特定分数的日期
      if (options.g !== null) {
        // 验证分数范围和处理逻辑保持不变...
        if (!Number.isInteger(options.g) || options.g < 0 || options.g > 100) {
          const message = await session.send(session.text('commands.jrrp.messages.invalid_number'));
          await utils.autoRecall(session, message);
          return;
        }

        const identificationCode = jrrpIdentification.getIdentificationCode(session.userId);
        await utils.findDateForScore(session, options.g, identificationCode, calculateScore);
        return;
      }

      // 处理日期解析和运势计算
      let dateForCalculation = new Date();
      if (options?.d) {
        const date = utils.parseDate(options.d, dateForCalculation);
        if (!date) {
          const message = await session.send(session.text('commands.jrrp.errors.invalid_date'));
          await utils.autoRecall(session, message);
          return;
        }
        dateForCalculation = date;
      }

      // 计算运势
      try {
        // 格式化日期字符串
        const year = dateForCalculation.getFullYear();
        const monthStr = String(dateForCalculation.getMonth() + 1).padStart(2, '0');
        const dayStr = String(dateForCalculation.getDate()).padStart(2, '0');
        const formattedDateTime = `${year}-${monthStr}-${dayStr}`;
        const monthDay = `${monthStr}-${dayStr}`;

        // 处理节日特殊消息
        if (config.holidayMessages?.[monthDay]) {
          const holidayMessage = session.text(config.holidayMessages[monthDay]);
          const holidayPromptMessage = await session.send(holidayMessage + '\n' + session.text('commands.jrrp.messages.prompt'));
          await utils.autoRecall(session, holidayPromptMessage);
          const response = await session.prompt(CONSTANTS.TIMEOUTS.PROMPT);
          if (!response) {
            await session.send(session.text('commands.jrrp.messages.cancel'));
            return;
          }
        }

        const userNickname = session.username || 'User'
        let userFortune: number
        const userDateSeed = `${session.userId}-${formattedDateTime}`

        const identificationCode = jrrpIdentification.getIdentificationCode(session.userId);
        userFortune = calculateScore(userDateSeed, dateForCalculation, identificationCode);

        // 处理特殊码零分确认
        if (identificationCode && userFortune === 0) {
          await session.send(session.text('commands.jrrp.messages.special_mode.zero_prompt'));
          const response = await session.prompt(CONSTANTS.TIMEOUTS.PROMPT);
          if (!response || response.toLowerCase() !== 'y') {
            const message = await session.send(session.text('commands.jrrp.messages.cancel'));
            await utils.autoRecall(session, message);
            return;
          }
        }

        // 格式化分数显示
        const formattedFortune = jrrpIdentification.formatScore(userFortune, dateForCalculation, config.fool);
        let fortuneResultText = session.text('commands.jrrp.messages.result', [formattedFortune, userNickname]);

        // 处理特殊分数消息
        if (identificationCode) {
          if (userFortune === 100 && jrrpIdentification.isFirst100(session.userId)) {
            await jrrpIdentification.markFirst100(session.userId);
            fortuneResultText += session.text(config.specialMessages[userFortune]) +
                          '\n' + session.text('commands.jrrp.messages.special_mode.first_100');
          } else if (config.specialMessages && userFortune in config.specialMessages) {
            fortuneResultText += session.text(config.specialMessages[userFortune]);
          }
        } else if (config.specialMessages && userFortune in config.specialMessages) {
          fortuneResultText += session.text(config.specialMessages[userFortune]);
        }

        // 处理分数范围消息
        if (!config.specialMessages?.[userFortune] && config.rangeMessages) {
          for (const [range, rangeMessage] of Object.entries(config.rangeMessages)) {
            const [min, max] = range.split('-').map(Number);
            if (!isNaN(min) && !isNaN(max) && userFortune >= min && userFortune <= max) {
              fortuneResultText += session.text(rangeMessage);
              break;
            }
          }
        }

        // 发送结果
        await session.send(fortuneResultText);
        return;
      } catch (error) {
        console.error('Daily fortune calculation failed:', error);
        const message = await session.send(session.text('commands.jrrp.messages.error', []));
        await utils.autoRecall(session, message);
        return;
      }
    })
}

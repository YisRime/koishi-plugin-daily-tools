// 基础依赖导入和插件元数据定义
import { Context, Schema, Random, h } from 'koishi'
import {} from 'koishi-plugin-adapter-onebot'
import { ZanwoManager } from './utils/ZanwoManager'
import { ConfigValidator } from './utils/ConfigValidator'
import { JrrpSpecialMode } from './utils/JrrpSpecialMode'
import * as utils from './utils/utils'
import { CONSTANTS } from './utils/utils'

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
  adminAccount?: string  // 改为 adminAccount
  enableNotify?: boolean
  adminOnly?: boolean    // 添加新配置项
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
    adminAccount: Schema.string(),
    enableNotify: Schema.boolean().default(true),
    adminOnly: Schema.boolean().default(true),
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

// 插件应用函数
// 注册命令和处理逻辑
export async function apply(ctx: Context, config: Config) {
  // 初始化配置验证
  new ConfigValidator(config).validate();

  ctx.i18n.define('zh-CN', require('./locales/zh-CN'));
  ctx.i18n.define('en-US', require('./locales/en-US'));

  const jrrpSpecial = new JrrpSpecialMode(ctx);

  // 启动缓存清理器
  utils.startCacheCleaner();

  const zanwoManager = new ZanwoManager(ctx);

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
    .option('z', '-z')
    .option('a', '-a <target:text>')
    .option('r', '-r <target:text>')
    .option('l', '-l')
    .action(async ({ session, options }) => {
      // 添加列表查看功能
      if (options?.l) {
        const targets = zanwoManager.getList();
        if (!targets.length) {
          return session.send(session.text('commands.zanwo.messages.no_targets'));
        }

        return session.send(
          session.text('commands.zanwo.messages.list', [targets.join(', ')])
        );
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

        let success = true;
        for (const targetId of targets) {
          if (!await zanwoManager.sendLikes(session, targetId)) {
            success = false;
            break;
          }
        }

        const message = await session.send(
          session.text(`commands.zanwo.messages.batch_${success ? 'success' : 'failed'}`)
        );
        await utils.autoRecall(session, message);
        return;
      }

      // 单个点赞
      let targetId = session.userId;
      if (options?.u) {
        targetId = utils.parseTarget(options.u) || session.userId;
        if (targetId === session.userId) {
          const message = await session.send(session.text('commands.zanwo.messages.target_not_found'));
          await utils.autoRecall(session, message);
          return;
        }
      }

      const success = await zanwoManager.sendLikes(session, targetId);
      const message = await session.send(
        success
          ? session.text('commands.zanwo.messages.success', [config.enableNotify ? (config.adminAccount || '') : ''])
          : session.text('commands.zanwo.messages.like_failed')
      );
      await utils.autoRecall(session, message);
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
            await utils.executeMute(session, session.userId, muteDuration, config.mute.enableMessage);
            return;
          }

          // 随机选择目标并执行禁言
          const targetIndex = random.int(0, validMembers.length - 1);
          await utils.executeMute(session, validMembers[targetIndex], muteDuration, config.mute.enableMessage);
          return;
        } catch {
          const message = await session.send(session.text('commands.mute.messages.no_valid_members'));
          await utils.autoRecall(session, message);
          return;
        }
      }

      // 处理指定目标禁言模式
      if (options?.u) {
        const targetId = utils.parseTarget(options.u);

        // 如果目标无效或是自己，则禁言自己
        if (!targetId || targetId === session.userId) {
          await utils.executeMute(session, session.userId, muteDuration, config.mute.enableMessage);
          return;
        }

        // 根据概率决定是禁言自己还是目标
        if (!random.bool(config.mute.probability)) {
          await utils.executeMute(session, session.userId, muteDuration, config.mute.enableMessage);
          return;
        }

        await utils.executeMute(session, targetId, muteDuration, config.mute.enableMessage);
        return;
      }

      // 默认禁言自己
      await utils.executeMute(session, session.userId, muteDuration, config.mute.enableMessage);
    });

  // 今日人品命令处理
  ctx.command('jrrp')
    .option('d', '-d <date>', { type: 'string' })
    .option('b', '-b <code>', { type: 'string' })
    .option('g', '-g <number:number>', { fallback: null })
    .action(async ({ session, options }) => {
      // 处理查找特定分数的日期
      if ('g' in options && options.g !== null) {
        // 验证分数范围
        if (options.g < 0 || options.g > 100) {
          const message = await session.send(session.text('commands.jrrp.messages.invalid_number'));
          await utils.autoRecall(session, message);
          return;
        }

        const specialCode = jrrpSpecial.getSpecialCode(session.userId);
        await utils.findDateForScore(session, options.g, specialCode, calculateScore);
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
        const date = utils.parseDate(options.d, targetDate);
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
            await session.send(session.text('commands.jrrp.messages.cancel'));
            return;
          }
        }

        const userNickname = session.username || 'User'
        let luckScore: number
        const userDateSeed = `${session.userId}-${currentDateStr}`

        const specialCode = jrrpSpecial.getSpecialCode(session.userId);
        luckScore = calculateScore(userDateSeed, targetDate, specialCode);

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

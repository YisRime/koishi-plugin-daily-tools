import { Session, h, Random } from 'koishi';
import { MuteDurationType, SleepMode } from './index';

/**
 * 缓存条目接口定义
 * @interface CacheEntry
 * @property {string[]} data - 缓存的数据内容
 * @property {number} expiry - 过期时间戳
 */
interface CacheEntry {
  data: string[];
  expiry: number;
}

/**
 * 全局缓存管理器
 * @namespace cache
 */
const cache = {
  members: new Map<string, CacheEntry>(),

  /**
   * 启动缓存清理定时任务
   * @param {number} interval - 清理间隔时间(毫秒)
   * @returns {NodeJS.Timer} 定时器句柄
   */
  cleanup: (interval = 6 * 60 * 60 * 1000) => {
    return setInterval(() => {
      const now = Date.now();
      cache.members.forEach((entry, key) => {
        if (entry.expiry <= now) cache.members.delete(key);
      });
    }, interval);
  }
};

/**
 * 消息处理工具集
 * @namespace messageHandler
 */
const messageHandler = {
  /**
   * 自动撤回消息
   * @param {Session} session - 会话上下文
   * @param {any} message - 要撤回的消息
   * @param {number} delay - 延迟时间(毫秒)
   * @returns {Promise<() => void>} 取消撤回的函数
   */
  autoRecall: async (session: Session, message: any, delay = 10000) => {
    if (!message) return;
    const timer = setTimeout(async () => {
      try {
        const messages = Array.isArray(message) ? message : [message];
        await Promise.all(messages.map(msg => {
          const msgId = typeof msg === 'string' ? msg : msg?.id;
          if (msgId) return session.bot.deleteMessage(session.channelId, msgId);
        }));
      } catch (error) {
        console.warn('Auto recall failed:', error);
      }
    }, delay);
    return () => clearTimeout(timer);
  }
};

/**
 * 群操作处理工具集
 * @namespace operationHandler
 */
const operationHandler = {
  /**
   * 获取群成员列表
   * @param {Session} session - 会话上下文
   * @returns {Promise<string[]>} 成员ID列表
   */
  getMemberList: async (session: Session): Promise<string[]> => {
    const cacheKey = `${session.platform}:${session.guildId}`;
    const cached = cache.members.get(cacheKey);
    if (cached?.expiry > Date.now()) return cached.data;

    try {
      const members: string[] = [];
      for await (const member of session.bot.getGuildMemberIter(session.guildId)) {
        if (String(member.user?.id) !== String(session.selfId)) {
          members.push(String(member.user?.id));
        }
      }

      cache.members.set(cacheKey, {
        data: members,
        expiry: Date.now() + 3600000
      });
      return members;
    } catch {
      return [];
    }
  },

  /**
   * 执行禁言操作
   * @param {Session} session - 会话上下文
   * @param {string} targetId - 目标用户ID
   * @param {number} duration - 禁言时长(秒)
   * @param {boolean} enableMessage - 是否发送提示消息
   * @returns {Promise<boolean>} 操作是否成功
   */
  mute: async (session: Session, targetId: string, duration: number, enableMessage: boolean) => {
    try {
      await session.bot.muteGuildMember(session.guildId, targetId, duration * 1000);
      session.messageId && await session.bot.deleteMessage(session.channelId, session.messageId);

      if (enableMessage) {
        const [min, sec] = [(duration / 60) | 0, duration % 60];
        const isSelf = targetId === session.userId;
        const username = isSelf ? session.username
          : ((await session.app.database.getUser(session.platform, targetId))?.name || targetId);

        const msg = await session.send(session.text(
          `commands.mute.messages.notify.${isSelf ? 'self' : 'target'}_muted`,
          [username, min, sec]
        ));
        await messageHandler.autoRecall(session, msg);
      }
      return true;
    } catch (error) {
      console.error('Mute operation failed:', error);
      return false;
    }
  }
};

/**
 * 工具函数集合
 * @namespace utils
 */
export const utils = {
  /**
   * 解析目标用户ID
   * @param {string} input - 输入文本
   * @returns {string|null} 解析后的用户ID
   */
  parseTarget: (input: string): string | null => {
    if (!input?.trim()) return null;
    const parsed = h.parse(input)[0];
    return parsed?.type === 'at' ? parsed.attrs.id : input.trim();
  },

  /**
   * 计算禁言时长
   * @param {MuteDurationType} type - 禁言类型
   * @param {number} defaultDuration - 默认时长
   * @param {number} min - 最小时长
   * @param {number} max - 最大时长
   * @param {number} [specified] - 指定时长
   * @returns {number} 计算后的禁言时长(秒)
   */
  calculateMuteDuration: (
    type: MuteDurationType,
    defaultDuration: number,
    min: number,
    max: number,
    specified?: number
  ): number => {
    if (specified) return specified * 60;
    return type === MuteDurationType.RANDOM
      ? new Random().int(min * 60, max * 60)
      : defaultDuration * 60;
  },

  ...messageHandler,
  ...operationHandler,
  startCacheCleaner: cache.cleanup
};

/**
 * 配置验证器类
 * @class ConfigValidator
 */
export class ConfigValidator {
  /**
   * 创建配置验证器实例
   * @param {any} config - 插件配置对象
   */
  constructor(private config: any) {}

  /**
   * 执行配置验证
   * @throws {Error} 配置无效时抛出错误
   */
  validate(): void {
    if (this.config.sleep.type === SleepMode.UNTIL &&
      !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(this.config.sleep.until)) {
      throw new Error('Invalid sleep end time format');
    }
  }
}

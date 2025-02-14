import { Session, h } from 'koishi';
import { EntertainmentMode, DisplayMode } from '../index';

/**
 * 常量配置对象，包含各种系统配置值
 * @namespace
 * @property {Object} CACHE_KEYS - 缓存键生成函数集合
 * @property {Object} TIMEOUTS - 超时时间配置
 * @property {Object} LIMITS - 系统限制配置
 */
export const CONSTANTS = {
  CACHE_KEYS: {
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

/**
 * 缓存配置对象，定义各类缓存的过期时间
 * @namespace
 * @property {number} memberListExpiry - 成员列表缓存过期时间（毫秒）
 * @property {number} scoreExpiry - 分数缓存过期时间（毫秒）
 */
export const cacheConfig = {
  memberListExpiry: 3600000,
  scoreExpiry: 86400000,
};

/**
 * 缓存存储对象，用于在内存中存储各类数据
 * @namespace
 * @property {Map<string, {members: string[], expiry: number}>} memberListCache - 群成员列表缓存
 * @property {Map<string, {score: number, expiry: number}>} scoreCache - 分数缓存
 */
export const cacheStore = {
  memberListCache: new Map<string, { members: string[], expiry: number }>(),
  scoreCache: new Map<string, { score: number, expiry: number }>(),
};

/**
 * 自动撤回消息
 * @param {Session} session - 会话上下文
 * @param {string|string[]|object|object[]} message - 要撤回的消息或消息ID数组
 * @param {number} [delay] - 延迟撤回时间（毫秒）
 * @returns {Promise<Function>} 取消撤回的函数
 */
export async function autoRecall(session, message, delay = CONSTANTS.TIMEOUTS.AUTO_RECALL) {
  if (!message) return;

  const timer = setTimeout(async () => {
    if (Array.isArray(message)) {
      const results = [];
      for (let i = 0; message.length > i; i += 5) {
        const batch = message.slice(i, i + 5);
        const batchResults = await Promise.all(batch.map(async (msg) => {
          const msgId = typeof msg === 'string' ? msg : msg?.id;
          if (msgId) return session.bot.deleteMessage(session.channelId, msgId)
            .catch(() => null);
        }));
        results.push(...batchResults);
      }
    } else {
      const msgId = typeof message === 'string' ? message : message?.id;
      if (msgId) await session.bot.deleteMessage(session.channelId, msgId)
        .catch(() => null);
    }
  }, delay);

  return () => clearTimeout(timer);
}

/**
 * 获取缓存的群成员列表
 * @param {Session} session - 会话上下文
 * @returns {Promise<string[]>} 群成员ID列表
 */
export async function getCachedMemberList(session): Promise<string[]> {
  const cacheKey = `${session.platform}:${session.guildId}`;
  const now = Date.now();
  const cached = cacheStore.memberListCache.get(cacheKey);

  if (cached && cached.expiry > now) {
    return cached.members;
  }

  const members = await session.onebot.getGroupMemberList(session.guildId);
  const validMembers = members
    .filter(m => m.role === 'member' && String(m.user_id) !== String(session.selfId))
    .map(m => String(m.user_id));

  cacheStore.memberListCache.set(cacheKey, {
    members: validMembers,
    expiry: now + cacheConfig.memberListExpiry
  });

  return validMembers;
}

/**
 * 获取缓存的分数
 * @param {string} key - 缓存键
 * @returns {number|null} 缓存的分数，不存在或过期则返回null
 */
export function getCachedScore(key: string): number | null {
  const cached = cacheStore.scoreCache.get(key);
  if (cached && cached.expiry > Date.now()) {
    return cached.score;
  }
  return null;
}

/**
 * 设置分数缓存
 * @param {string} key - 缓存键
 * @param {number} score - 要缓存的分数
 * @returns {void}
 */
export function setCachedScore(key: string, score: number): void {
  cacheStore.scoreCache.set(key, {
    score,
    expiry: Date.now() + cacheConfig.scoreExpiry
  });
}

/**
 * 启动缓存清理器，定期清理过期的缓存数据
 * @param {number} [interval] - 清理间隔时间（毫秒），默认6小时
 * @returns {void}
 */
export function startCacheCleaner(interval = 21600000) {
  setInterval(() => {
    const now = Date.now();
    for (const cache of Object.values(cacheStore)) {
      for (const [key, value] of cache.entries()) {
        if (value.expiry <= now) cache.delete(key);
      }
    }
  }, interval);
}

/**
 * 计算字符串的哈希值
 * @param {string} str - 输入字符串
 * @returns {number} 32位无符号整数哈希值
 */
export function hashCode(str: string): number {
  let hash = 5381;
  for (let i = 0; str.length > i; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash;
}

/**
 * 解析并验证日期字符串
 * @param {string} dateStr - 日期字符串，支持YYYY-MM-DD、YY-MM-DD、MM-DD等格式
 * @param {Date} defaultDate - 默认日期，用于补充年份信息
 * @returns {Date|null} 解析后的日期对象，解析失败则返回null
 */
export function parseDate(dateStr: string, defaultDate: Date): Date | null {
  // 标准化日期字符串
  const normalizedDate = dateStr.replace(/[\s.\/]/g, '-').replace(/-+/g, '-');

  // 验证输入是否为纯数字和分隔符
  if (!/^[\d-]+$/.test(normalizedDate)) {
    return null;
  }

  // 匹配不同的日期格式，但要求数字部分必须是纯数字（不含前导零）
  const fullMatch = normalizedDate.match(/^([1-9]\d{3})-([1-9]|1[0-2]|0?[1-9])-([1-9]|[12]\d|3[01]|0?[1-9])$/);
  const shortYearMatch = normalizedDate.match(/^([1-9]|[1-9]\d)-([1-9]|1[0-2]|0?[1-9])-([1-9]|[12]\d|3[01]|0?[1-9])$/);
  const shortMatch = normalizedDate.match(/^([1-9]|1[0-2]|0?[1-9])-([1-9]|[12]\d|3[01]|0?[1-9])$/);

  if (fullMatch) {
    const [_, year, month, day] = fullMatch.map(Number);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day) {
      return date;
    }
    return null;
  } else if (shortYearMatch) {
    const [_, year, month, day] = shortYearMatch.map(Number);
    let fullYear: number;
    const currentYear = defaultDate.getFullYear();
    const currentYearLastTwo = currentYear % 100;

    if (year >= 0 && year <= 99) {
      const threshold = (currentYearLastTwo + 20) % 100;
      fullYear = year > threshold ? 1900 + year : 2000 + year;
    } else {
      return null;
    }

    const date = new Date(fullYear, month - 1, day);
    if (date.getMonth() === month - 1 &&
        date.getDate() === day) {
      return date;
    }
    return null;
  } else if (shortMatch) {
    const [_, month, day] = shortMatch.map(Number);
    const date = new Date(defaultDate.getFullYear(), month - 1, day);
    if (date.getMonth() === month - 1 &&
        date.getDate() === day) {
      return date;
    }
    return null;
  }
  return null;
}

/**
 * 执行禁言操作并处理结果
 * @param {Session} session - 会话上下文
 * @param {string} targetId - 目标用户ID
 * @param {number} muteDuration - 禁言时长（秒）
 * @param {boolean} enableMessage - 是否发送禁言提示消息
 * @returns {Promise<boolean>} 操作是否成功
 */
export async function executeMute(session: Session, targetId: string, muteDuration: number, enableMessage: boolean): Promise<boolean> {
  try {
    await session.onebot.setGroupBan(session.guildId, targetId, muteDuration);

    if (session.messageId) {
      try {
        await session.bot.deleteMessage(session.channelId, session.messageId);
      } catch {}
    }

    if (enableMessage) {
      const [minutes, seconds] = [(muteDuration / 60) | 0, muteDuration % 60];
      const isTargetSelf = targetId === session.userId;
      const messageKey = isTargetSelf
        ? 'commands.mute.messages.notify.self_muted'
        : 'commands.mute.messages.notify.target_muted';

      const username = isTargetSelf
        ? session.username
        : ((await session.app.database.getUser(session.platform, targetId))?.name || targetId);

      const message = await session.send(session.text(messageKey, [username, minutes, seconds]));
      await autoRecall(session, message);
    }
    return true;
  } catch (error) {
    console.error('Mute operation failed:', error);
    return false;
  }
}

/**
 * 处理特定分数的日期查找
 * @param {Session} session - 会话上下文
 * @param {number} targetScore - 目标分数
 * @param {string|null} specialCode - 特殊代码
 * @param {Function} calculateScore - 分数计算函数
 * @returns {Promise<void>}
 */
export async function findDateForScore(
  session: Session,
  targetScore: number,
  specialCode: string | null,
  calculateScore: (userDateSeed: string, date: Date, specialCode: string | undefined) => number
): Promise<void> {
  const currentDate = new Date();

  for (let i = 1; i <= CONSTANTS.LIMITS.MAX_DAYS_TO_CHECK; i++) {
    const checkDate = new Date(currentDate);
    checkDate.setDate(currentDate.getDate() + i);

    const dateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
    const userDateSeed = `${session.userId}-${dateStr}`;
    const score = calculateScore(userDateSeed, checkDate, specialCode);

    if (score === targetScore) {
      const formattedDate = `${checkDate.getFullYear().toString().slice(-2)}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
      await session.send(session.text('commands.jrrp.messages.found_date', [targetScore, formattedDate]));
      return;
    }
  }

  await session.send(session.text('commands.jrrp.messages.not_found', [targetScore]));
}

/**
 * 检查并处理节日消息
 * @param {Session} session - 会话上下文
 * @param {string} monthDay - 月日字符串（MM-DD格式）
 * @param {Record<string, string>} holidayMessages - 节日消息配置
 * @returns {Promise<boolean>} 是否继续执行后续操作
 */
export async function handleHolidayMessage(session: Session, monthDay: string, holidayMessages: Record<string, string>): Promise<boolean> {
  if (holidayMessages?.[monthDay]) {
    const holidayMessage = session.text(holidayMessages[monthDay]);
    const promptMessage = await session.send(holidayMessage + '\n' + session.text('commands.jrrp.messages.prompt'));
    await autoRecall(session, promptMessage);
    const response = await session.prompt(CONSTANTS.TIMEOUTS.PROMPT);
    if (!response) {
      await session.send(session.text('commands.jrrp.messages.cancel'));
      return false;
    }
  }
  return true;
}

/**
 * 解析目标用户ID
 * @param {string} input - 输入文本，可以是@消息或直接的用户ID
 * @returns {string|null} 解析出的用户ID，解析失败则返回null
 */
export function parseTarget(input: string): string | null {
  if (!input?.trim()) return null;
  const parsedUser = h.parse(input)[0];
  return parsedUser?.type === 'at' ? parsedUser.attrs.id : input.trim();
}

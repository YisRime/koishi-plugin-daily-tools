import { Session, h } from 'koishi';

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
    FOOL_CACHE_SIZE: 5, // 愚人模式缓存的结果数量
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
  foolExpiry: 86400000, // 愚人模式缓存24小时过期
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
  foolCache: new Map<string, { expressions: string[], expiry: number }>(),
};

/**
 * 自动撤回消息
 * @param {Session} session - 会话上下文
 * @param {string|string[]|object|object[]} message - 要撤回的消息或消息ID数组
 * @param {number} [delay] - 延迟撤回时间（毫秒），默认使用 CONSTANTS.TIMEOUTS.AUTO_RECALL
 * @returns {Promise<Function>} 取消撤回的函数
 */
export async function autoRecall(session, message, delay = CONSTANTS.TIMEOUTS.AUTO_RECALL) {
  if (!message) return;

  const timer = setTimeout(async () => {
    try {
      const messages = Array.isArray(message) ? message : [message];
      await Promise.all(messages.map(async msg => {
        const msgId = typeof msg === 'string' ? msg : msg?.id;
        if (msgId) {
          await session.bot.deleteMessage(session.channelId, msgId);
        }
      }));
    } catch (error) {
      console.warn('Failed to execute auto recall:', error);
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
  const memberCacheKey = `${session.platform}:${session.guildId}`;
  const currentTime = Date.now();
  const cachedMembers = cacheStore.memberListCache.get(memberCacheKey);

  if (cachedMembers && cachedMembers.expiry > currentTime) {
    return cachedMembers.members;
  }

  try {
    const memberList = await session.onebot.getGroupMemberList(session.guildId);
    const filteredMembers = memberList
      .filter(member =>
        member.role === 'member' &&
        String(member.user_id) !== String(session.selfId))
      .map(member => String(member.user_id));

    if (!Array.isArray(filteredMembers)) {
      throw new Error('Invalid member list format');
    }

    cacheStore.memberListCache.set(memberCacheKey, {
      members: filteredMembers,
      expiry: currentTime + cacheConfig.memberListExpiry
    });

    return filteredMembers;
  } catch (error) {
    console.error('Failed to get member list:', error);
    // 如果获取失败但有缓存，使用过期的缓存作为后备
    if (cachedMembers) {
      return cachedMembers.members;
    }
    return [];
  }
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
 * @param {string} inputStr - 输入字符串
 * @returns {number} 32位无符号整数哈希值
 */
export function hashCode(inputStr: string): number { // 改进：str -> inputStr
  let hashValue = 5381; // 改进：hash -> hashValue
  for (let charIndex = 0; inputStr.length > charIndex; charIndex++) { // 改进：i -> charIndex
    hashValue = ((hashValue << 5) + hashValue) + inputStr.charCodeAt(charIndex);
    hashValue = hashValue >>> 0;
  }
  return hashValue;
}

/**
 * 解析并验证日期字符串
 * @param {string} dateStr - 日期字符串，支持YYYY-MM-DD、YY-MM-DD、MM-DD等格式
 * @param {Date} defaultDate - 默认日期，用于补充年份信息
 * @returns {Date|null} 解析后的日期对象，解析失败则返回null
 */
export function parseDate(dateStr: string, defaultDate: Date): Date | null {
  // 标准化日期字符串，支持点号和斜杠分隔
  const normalized = dateStr.replace(/[\s.\/]/g, '-').replace(/-+/g, '-');
  if (!/^[\d-]+$/.test(normalized)) return null;

  // 处理可能的前导零
  const parts = normalized.split('-').map(part => parseInt(part.replace(/^0+/, ''), 10));
  if (!parts.every(n => n > 0)) return null;

  let year: number, month: number, day: number;

  switch (parts.length) {
    case 3: // YYYY-MM-DD 或 YY-MM-DD
      [year, month, day] = parts;
      if (year < 100) {
        const currentYear = defaultDate.getFullYear();
        const threshold = (currentYear % 100 + 20) % 100;
        year = year > threshold ? 1900 + year : 2000 + year;
      }
      break;
    case 2: // MM-DD
      [month, day] = parts;
      year = defaultDate.getFullYear();
      break;
    default:
      return null;
  }

  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  ) ? date : null;
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

  for (let daysAhead = 1; daysAhead <= CONSTANTS.LIMITS.MAX_DAYS_TO_CHECK; daysAhead++) {
    const futureDate = new Date(currentDate);
    futureDate.setDate(currentDate.getDate() + daysAhead);

    const dateStr = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
    const userDateSeed = `${session.userId}-${dateStr}`;
    const score = calculateScore(userDateSeed, futureDate, specialCode);

    if (score === targetScore) {
      const formattedDate = `${futureDate.getFullYear().toString().slice(-2)}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
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

/**
 * 获取缓存的愚人模式表达式
 * @param {string} key - 缓存键
 * @returns {string[]|null} 缓存的表达式数组，不存在或过期则返回null
 */
export function getCachedFoolExpressions(key: string): string[] | null {
  if (!key.startsWith('fool:')) return null; // 只处理愚人模式的缓存
  const cached = cacheStore.foolCache.get(key);
  if (cached && cached.expiry > Date.now()) {
    return cached.expressions;
  }
  return null;
}

/**
 * 设置愚人模式表达式缓存
 * @param {string} key - 缓存键
 * @param {string[]} expressions - 要缓存的表达式数组
 */
export function setCachedFoolExpressions(key: string, expressions: string[]): void {
  if (!key.startsWith('fool:')) return; // 只处理愚人模式的缓存
  cacheStore.foolCache.set(key, {
    expressions,
    expiry: Date.now() + cacheConfig.foolExpiry
  });
}

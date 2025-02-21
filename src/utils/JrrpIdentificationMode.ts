import { Session, Context } from 'koishi'
import { DisplayMode, FoolConfig, FoolMode } from '..'
import { CONSTANTS } from './utils'
import { autoRecall } from './utils'

/**
 * 表达式生成策略类型定义
 */
type ExpressionStrategy = (target: number, baseNumber: number) => string;

/**
 * JRRP识别码模式常量定义
 */
const JRRP_CONSTANTS = {
  /** 表达式缓存大小限制 */
  MAX_EXPR_CACHE_SIZE: 1000,
  /** 哈希种子值 */
  HASH_SEED: BigInt('0xa98f501bc684032f'),
  /** 哈希初始值 */
  HASH_INITIAL: BigInt(5381),
  /** 识别码格式正则 */
  CODE_FORMAT: /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/i
} as const;

/**
 * JRRP识别码模式处理类
 * 处理用户识别码绑定和今日人品计算规则
 */
export class JrrpIdentificationMode {
  // === 私有属性 ===
  /** 用户识别码映射 */
  private readonly identificationCodes = new Map<string, string>();
  /** 满分记录映射 */
  private readonly perfectScoreRecords = new Map<string, boolean>();
  /** 数字表达式缓存 */
  private readonly digitExpressions = new Map<number, string>();
  /** 表达式缓存初始化标记 */
  private expressionsInitialized = false;

  constructor(private readonly ctx: Context) {
    this.loadData();
  }

  // === 数据管理方法 ===
  /**
   * 从数据库加载JRRP数据
   */
  private async loadData(): Promise<void> {
    try {
      const records = await this.ctx.database.get('daily_user_data', {})
      for (const record of records) {
        if (record.identification_code) {
          this.identificationCodes.set(record.user_id, record.identification_code)
        }
        this.perfectScoreRecords.set(record.user_id, record.perfect_score)
      }
    } catch (error) {
      this.ctx.logger.error('Failed to load JRRP data:', error)
    }
  }

  // === 识别码管理方法 ===
  /**
   * 验证识别码格式
   */
  validateIdentificationCode(code: string): boolean {
    return JRRP_CONSTANTS.CODE_FORMAT.test(code.trim());
  }

  /**
   * 绑定用户识别码
   */
  async bindIdentificationCode(userId: string, code: string): Promise<void> {
    try {
      const formattedCode = code.trim().toUpperCase();
      await this.ctx.database.upsert('daily_user_data', [{
        user_id: userId,
        identification_code: formattedCode
      }], ['user_id'])
      this.identificationCodes.set(userId, formattedCode)
    } catch (error) {
      this.ctx.logger.error('Failed to bind identification code:', error)
    }
  }

  /**
   * 移除用户识别码
   */
  async removeIdentificationCode(userId: string): Promise<void> {
    try {
      await this.ctx.database.set('daily_user_data', {
        user_id: userId
      }, {
        identification_code: null
      })
      this.identificationCodes.delete(userId)
    } catch (error) {
      this.ctx.logger.error('Failed to remove identification code:', error)
    }
  }

  /**
   * 获取用户识别码
   */
  getIdentificationCode(userId: string): string | undefined {
    return this.identificationCodes.get(userId);
  }

  // === 分数处理方法 ===
  /**
   * 标记用户满分状态
   */
  async markPerfectScore(userId: string): Promise<void> {
    try {
      await this.ctx.database.upsert('daily_user_data', [{
        user_id: userId,
        perfect_score: true
      }], ['user_id'])
      this.perfectScoreRecords.set(userId, true)
    } catch (error) {
      this.ctx.logger.error('Failed to mark perfect score:', error)
    }
  }

  /**
   * 检查是否首次满分
   */
  isPerfectScoreFirst(userId: string): boolean {
    return !this.perfectScoreRecords.get(userId);
  }

  // === JRRP计算方法 ===
  /**
   * 计算指定日期在一年中的天数
   */
  private getDayOfYear(date: Date): number {
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date.getTime() - start.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  /**
   * 计算字符串的64位哈希值
   */
  private getHash(str: string): bigint {
    let hash = JRRP_CONSTANTS.HASH_INITIAL;
    for (let i = 0; str.length > i; i++) {
      hash = ((hash << BigInt(5)) ^ hash ^ BigInt(str.charCodeAt(i))) & ((BigInt(1) << BigInt(64)) - BigInt(1));
    }
    return hash ^ JRRP_CONSTANTS.HASH_SEED;
  }

  /**
   * 使用识别码计算JRRP值
   */
  calculateJrrpWithCode(code: string, date: Date, password: string): number {
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
      code,
      '0*8&6',
      String(day),
      'kjhg'
    ].join(''));

    const divisorThree = BigInt(3);
    const mergedHash = (hash1 / divisorThree + hash2 / divisorThree);
    const normalizedHash = Math.abs(Number(mergedHash) / 527.0);
    const randomValue = Math.round(normalizedHash) % 1001;

    return randomValue >= 970 ? 100 : Math.round((randomValue / 969.0) * 99.0);
  }

  // === 分数格式化方法 ===
  /**
   * 格式化分数显示
   */
  public async formatScore(score: number, date: Date, foolConfig: FoolConfig): Promise<string> {
    if (!this.isFoolModeActive(foolConfig, date)) {
      return score.toString();
    }

    try {
      return await this.getFormattedScore(score, foolConfig);
    } catch (error) {
      this.ctx.logger.error('Error formatting score:', error);
      return score.toString();
    }
  }

  /**
   * 检查娱乐模式是否激活
   */
  private isFoolModeActive(foolConfig: FoolConfig, date: Date): boolean {
    if (foolConfig.type !== FoolMode.ENABLED) return false;
    if (!foolConfig.date) return true;

    const [month, day] = foolConfig.date.split('-').map(Number);
    return date.getMonth() + 1 === month && date.getDate() === day;
  }

  /**
   * 获取格式化的分数
   */
  private async getFormattedScore(score: number, foolConfig: FoolConfig): Promise<string> {
    if (foolConfig.displayMode === DisplayMode.BINARY) {
      return score.toString(2);
    }

    const baseNumber = foolConfig.baseNumber ?? 6;
    const strategies: Array<(target: number, base: number) => Promise<string>> = [
      this.generateDecimalExpression.bind(this),
      this.generatePrimeFactorsExpression.bind(this),
      this.generateMixedOperationsExpression.bind(this)
    ];

    return await strategies[Math.floor(Math.random() * strategies.length)](score, baseNumber);
  }

  // === 表达式生成方法 ===
  /**
   * 获取数字的基础表达式
   */
  private async getDigitExpr(n: number, baseNumber: number): Promise<string> {
    if (!this.expressionsInitialized) {
      await this.initializeExpressions(baseNumber);
    }
    return this.digitExpressions.get(n) || String(n);
  }

  /**
   * 初始化表达式缓存
   */
  private async initializeExpressions(baseNumber: number): Promise<void> {
    const b = baseNumber;
    this.digitExpressions.set(b, String(b));

    // 设置1-9的数字表达式
    for (let i = 1; i <= 9; i++) {
      if (i === b) continue;
      if (i <= 9) {
        this.digitExpressions.set(i, String(b === i ? b : i));
      }
    }

    // 设置需要特殊处理的数字
    this.digitExpressions.set(0, `(${b} ^ ${b})`);
    this.digitExpressions.set(10, `((${b} << ${b} / ${b}) + (${b} >> ${b} / ${b}))`);

    // 如果基础数字不是对应数字，设置特殊表达式
    if (b !== 1) this.digitExpressions.set(1, `(${b} / ${b})`);
    if (b !== 2) this.digitExpressions.set(2, `(${b} >> (${b} / ${b})`);
    if (b !== 3) this.digitExpressions.set(3, `(${b} / (${b} / ${b} << ${b} / ${b}))`);
    if (b !== 4) this.digitExpressions.set(4, `(${b} & (${b} | (${b} / ${b})))`);
    if (b !== 5) this.digitExpressions.set(5, `(${b} - ${b} / ${b})`);
    if (b !== 6) this.digitExpressions.set(6, `(${b} + (${b} / ${b} >> ${b} / ${b}))`);
    if (b !== 7) this.digitExpressions.set(7, `(${b} + ${b} / ${b})`);
    if (b !== 8) this.digitExpressions.set(8, `(${b} + ${b} / ${b} << ${b} / ${b})`);
    if (b !== 9) this.digitExpressions.set(9, `(${b} | (${b} >> ${b} / ${b}))`);

    this.expressionsInitialized = true;
  }

  /**
   * 生成十进制形式的表达式
   */
  private async generateDecimalExpression(target: number, baseNumber: number): Promise<string> {
    // 处理特殊情况和缓存
    if (target <= 10) return await this.getDigitExpr(target, baseNumber);
    const cached = this.digitExpressions.get(target);
    if (cached) return cached;

    // 处理100的特殊情况
    if (target === 100) {
      const expr = `(${await this.getDigitExpr(10, baseNumber)} * ${await this.getDigitExpr(10, baseNumber)})`;
      this.digitExpressions.set(100, expr);
      return expr;
    }

    const tens = Math.floor(target / 10);
    const ones = target % 10;

    // 生成表达式
    let expr: string;
    if (target <= 20) {
      // 11-20的数字使用加法表示
      expr = `(${await this.getDigitExpr(10, baseNumber)} + ${await this.getDigitExpr(ones, baseNumber)})`;
    } else if (ones === 0) {
      // 整十数使用乘法表示
      expr = `(${await this.getDigitExpr(tens, baseNumber)} * ${await this.getDigitExpr(10, baseNumber)})`;
    } else if (target <= 50) {
      // 50以内的数字使用乘加形式
      expr = `((${await this.getDigitExpr(tens, baseNumber)} * ${await this.getDigitExpr(10, baseNumber)}) + ${await this.getDigitExpr(ones, baseNumber)})`;
    } else {
      // 50以上的数字尝试使用更简洁的表达式
      const nearestTen = tens * 10;
      if (ones <= 5) {
        expr = `(${await this.generateDecimalExpression(nearestTen, baseNumber)} + ${await this.getDigitExpr(ones, baseNumber)})`;
      } else {
        const nextTen = (tens + 1) * 10;
        expr = `(${await this.generateDecimalExpression(nextTen, baseNumber)} - ${await this.getDigitExpr(10 - ones, baseNumber)})`;
      }
    }

    // 缓存生成的表达式
    this.digitExpressions.set(target, expr);
    return expr;
  }

  /**
   * 生成质因数分解形式的表达式
   */
  private async generatePrimeFactorsExpression(target: number, baseNumber: number): Promise<string> {
    // 处理10以内的数字直接返回表达式
    if (target <= 10) return await this.getDigitExpr(target, baseNumber);

    // 检查是否在预设表达式中
    const expr = this.digitExpressions.get(target);
    if (expr) return expr;
    if (target === 100) return `(${await this.getDigitExpr(10, baseNumber)} * ${await this.getDigitExpr(10, baseNumber)})`;

    // 递归分解函数
    const decompose = async (num: number): Promise<string> => {
      if (num <= 10) return await this.getDigitExpr(num, baseNumber);

      const predefinedExpr = this.digitExpressions.get(num);
      if (predefinedExpr) return predefinedExpr;

      // 尝试因式分解
      for (let i = Math.min(9, Math.floor(Math.sqrt(num))); i >= 2; i--) {
        if (num % i === 0) {
          const quotient = num / i;
          if (quotient <= 10) {
            return `(${await this.getDigitExpr(i, baseNumber)} * ${await this.getDigitExpr(quotient, baseNumber)})`;
          }
          // 递归分解较大的因子
          return `(${await this.getDigitExpr(i, baseNumber)} * ${await decompose(quotient)})`;
        }
      }

      // 无法分解时使用加减法
      const base = Math.floor(num / 10) * 10;
      const diff = num - base;
      if (diff === 0) {
        return await decompose(num / 10) + ` * ${await this.getDigitExpr(10, baseNumber)}`;
      }
      return diff > 0
        ? `(${await decompose(base)} + ${await this.getDigitExpr(diff, baseNumber)})`
        : `(${await decompose(base)} - ${await this.getDigitExpr(-diff, baseNumber)})`;
    };

    return await decompose(target);
  }

  /**
   * 生成混合运算形式的表达式
   */
  private async generateMixedOperationsExpression(target: number, baseNumber: number): Promise<string> {
    if (target <= 10) return await this.getDigitExpr(target, baseNumber);

    const cached = this.digitExpressions.get(target);
    if (cached) return cached;

    const b = await this.getDigitExpr(baseNumber, baseNumber);
    let expr = '';

    if (target === 0) {
      expr = `(${b} - ${b})`;
    } else if (target === 100) {
      expr = `(${b} * ${await this.generateMixedOperationsExpression(Math.floor(100/baseNumber), baseNumber)})`;
    } else {
      const strategies = [
        // 加减法策略 - 保持不变
        async () => {
          const base = Math.floor(target / 10) * 10;
          const diff = target - base;
          return diff >= 0
            ? `(${await this.generateMixedOperationsExpression(base, baseNumber)} + ${await this.getDigitExpr(diff, baseNumber)})`
            : `(${await this.generateMixedOperationsExpression(base, baseNumber)} - ${await this.getDigitExpr(-diff, baseNumber)})`;
        },
        // 改进的乘除法策略
        async () => {
          // 找到最接近的能被基数整除的数
          const quotient = Math.floor(target / baseNumber);
          const remainder = target % baseNumber;

          if (remainder === 0) {
            // 能整除的情况
            return `(${b} * ${await this.generateMixedOperationsExpression(quotient, baseNumber)})`;
          } else if (remainder <= baseNumber / 2) {
            // 余数较小时，使用加法
            return `((${b} * ${await this.generateMixedOperationsExpression(quotient, baseNumber)}) + ${await this.getDigitExpr(remainder, baseNumber)})`;
          } else {
            // 余数较大时，使用减法（向上取整）
            return `((${b} * ${await this.generateMixedOperationsExpression(quotient + 1, baseNumber)}) - ${await this.getDigitExpr(baseNumber - remainder, baseNumber)})`;
          }
        },
        // 改进的位运算策略，处理余数
        async () => {
          const maxShift = Math.floor(Math.log2(target));
          const base = 1 << maxShift;
          const remainder = target - base;

          if (remainder === 0) {
            return `(${b} << ${await this.getDigitExpr(maxShift, baseNumber)})`;
          } else if (remainder < 0) {
            // 如果目标值小于2的幂，使用减法
            return `((${b} << ${await this.getDigitExpr(maxShift, baseNumber)}) - ${await this.generateMixedOperationsExpression(-remainder, baseNumber)})`;
          } else {
            // 如果有余数，递归处理余数部分
            return `((${b} << ${await this.getDigitExpr(maxShift, baseNumber)}) + ${await this.generateMixedOperationsExpression(remainder, baseNumber)})`;
          }
        },
        // 新增：递归分解策略
        async () => {
          // 尝试找到最接近的可以简单表示的数
          for (let i = 1; i <= Math.min(10, target); i++) {
            if (target % i === 0) {
              const quotient = target / i;
              if (quotient <= 10) {
                return `(${await this.getDigitExpr(i, baseNumber)} * ${await this.getDigitExpr(quotient, baseNumber)})`;
              }
            }
          }
          // 如果找不到合适的因子，使用加减法
          const mid = Math.floor(target / 2);
          return `(${await this.generateMixedOperationsExpression(mid, baseNumber)} + ${await this.generateMixedOperationsExpression(target - mid, baseNumber)})`;
        }
      ];

      expr = await strategies[Math.floor(Math.random() * strategies.length)]();
    }

    this.digitExpressions.set(target, expr);
    return expr;
  }

  // === 消息处理方法 ===
  /**
   * 处理节日消息
   * @private
   */
  public async handleHolidayMessage(
    session: Session,
    monthDay: string,
    holidayMessages: Record<string, string>
  ): Promise<boolean> {
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
   * 查找指定分数的未来日期
   * @private
   */
  public async findDateForScore(
    session: Session,
    targetScore: number,
    specialCode: string | null,
    calculateScore: (userDateSeed: string, date: Date, specialCode: string | undefined) => Promise<number>
  ): Promise<void> {
    const currentDate = new Date();

    for (let daysAhead = 1; daysAhead <= CONSTANTS.LIMITS.MAX_DAYS_TO_CHECK; daysAhead++) {
      const futureDate = new Date(currentDate);
      futureDate.setDate(currentDate.getDate() + daysAhead);

      const dateStr = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
      const userDateSeed = `${session.userId}-${dateStr}`;
      const score = await calculateScore(userDateSeed, futureDate, specialCode);

      if (score === targetScore) {
        const formattedDate = `${futureDate.getFullYear().toString().slice(-2)}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
        await session.send(session.text('commands.jrrp.messages.found_date', [targetScore, formattedDate]));
        return;
      }
    }

    await session.send(session.text('commands.jrrp.messages.not_found', [targetScore]));
  }
}

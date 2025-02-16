import { Context } from 'koishi'
import { promises as fs } from 'fs'
import * as path from 'path'
import { DisplayMode, FoolConfig, FoolMode } from '..';
import { CONSTANTS } from './utils';
import * as utils from './utils';

/**
 * JRRP识别码模式处理类
 * 用于处理用户识别码绑定和今日人品计算规则，包括识别码的验证、绑定、
 * 移除以及基于识别码的JRRP计算。同时支持娱乐模式下的分数显示格式化。
 */
export class JrrpIdentificationMode {
  /** 存储用户ID和识别码的映射关系 */
  private identificationCodes = new Map<string, string>();

  /** 记录用户是否已获得过100点的状态 */
  private first100Records = new Map<string, boolean>();

  /** JRRP数据的持久化存储路径 */
  private readonly JRRP_DATA_PATH = 'data/jrrp.json';

  /** 存储数字到表达式的映射，用于生成数学表达式 */
  private digitExpressions = new Map<number, string>();

  private operators = [
    { op: '+', calc: (a: number, b: number) => a + b, weight: 10 },
    { op: '-', calc: (a: number, b: number) => a - b, weight: 8 },
    { op: '*', calc: (a: number, b: number) => a * b, weight: 6 },
    { op: '<<', calc: (a: number, b: number) => a << b, weight: 4 },
    { op: '>>', calc: (a: number, b: number) => a >> b, weight: 4 },
    { op: '|', calc: (a: number, b: number) => a | b, weight: 3 },
    { op: '&', calc: (a: number, b: number) => a & b, weight: 3 },
    { op: '^', calc: (a: number, b: number) => a ^ b, weight: 2 }
  ];

  /**
   * 创建JRRP特殊模式处理实例
   * @param ctx - Koishi应用上下文，用于日志记录和其他功能
   */
  constructor(private ctx: Context) {
    this.loadData();
  }

  /**
   * 计算指定日期在一年中的天数(1-366)
   * @param date 日期对象
   * @returns 一年中的第几天
   */
  private getDayOfYear(date: Date): number {
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date.getTime() - start.getTime();
    const oneDay = 1000 * 60 * 60 * 24;
    return Math.floor(diff / oneDay);
  }

  /**
   * 计算字符串的64位哈希值
   * @param str 输入字符串
   * @returns 64位哈希值
   */
  private getHash(str: string): bigint {
    let hash = BigInt(5381);
    for (let i = 0; str.length > i; i++) {
      hash = ((hash << BigInt(5)) ^ hash ^ BigInt(str.charCodeAt(i))) & ((BigInt(1) << BigInt(64)) - BigInt(1));
    }
    return hash ^ BigInt('0xa98f501bc684032f');
  }

  /**
   * 从文件加载持久化的JRRP数据
   */
  private async loadData(): Promise<void> {
    try {
      const exists = await fs.access(this.JRRP_DATA_PATH)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        const data = JSON.parse(await fs.readFile(this.JRRP_DATA_PATH, 'utf8'));
        await this.batchLoadData(data);
      }
    } catch (error) {
      this.ctx.logger.error('Failed to load JRRP data:', error);
    }
  }

  /**
   * 将JRRP数据保存到文件
   */
  private async saveData(): Promise<void> {
    try {
      const dir = path.dirname(this.JRRP_DATA_PATH);
      await fs.mkdir(dir, { recursive: true });

      const data = {
        codes: Object.fromEntries(this.identificationCodes),
        first100: Object.fromEntries(this.first100Records)
      };
      await fs.writeFile(this.JRRP_DATA_PATH, JSON.stringify(data, null, 2));
    } catch (error) {
      this.ctx.logger.error('Failed to save JRRP data:', error);
    }
  }

  /**
   * 标记用户已获得100点
   * @param userId 用户ID
   */
  async markFirst100(userId: string): Promise<void> {
    this.first100Records.set(userId, true);
    await this.saveData();
  }

  /**
   * 检查用户是否首次获得100点
   * @param userId 用户ID
   * @returns 是否是首次获得100点
   */
  isFirst100(userId: string): boolean {
    return !this.first100Records.get(userId);
  }

  /**
   * 验证识别码格式是否正确
   * @param code 识别码
   * @returns 是否符合XXXX-XXXX-XXXX-XXXX格式(X为16进制数字)
   */
  validateIdentificationCode(code: string): boolean {
    // 修改验证逻辑，使其更严格
    return /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/i.test(code.trim());
  }

  /**
   * 绑定用户的识别码
   * @param userId 用户ID
   * @param code 识别码
   */
  async bindIdentificationCode(userId: string, code: string): Promise<void> {
    this.identificationCodes.set(userId, code.trim().toUpperCase());
    await this.saveData();
  }

  /**
   * 移除用户的识别码
   * @param userId 用户ID
   */
  async removeIdentificationCode(userId: string): Promise<void> {
    this.identificationCodes.delete(userId);
    await this.saveData();
  }

  /**
   * 获取用户的识别码
   * @param userId 用户ID
   * @returns 用户绑定的识别码，未绑定则返回undefined
   */
  getIdentificationCode(userId: string): string | undefined {
    return this.identificationCodes.get(userId);
  }

  /**
   * 使用识别码计算JRRP值
   * @param code 识别码
   * @param date 日期
   * @param password 密码
   * @returns JRRP值(0-100)
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

  /**
   * 批量加载JRRP数据
   * @param data JRRP数据对象
   */
  private async batchLoadData(data: Record<string, any>) {
    const operations = [];

    if (data.codes) {
      operations.push(...Object.entries(data.codes)
        .map(([userId, code]) =>
          this.identificationCodes.set(userId, code as string)));
    }

    if (data.first100) {
      operations.push(...Object.entries(data.first100)
        .map(([userId, hadFirst100]) =>
          this.first100Records.set(userId, hadFirst100 as boolean)));
    }

    await Promise.all(operations);
  }

  /**
   * 初始化基础数字的表达式映射
   * @param baseNumber - 用于生成表达式的基础数字
   */
  private initDigitExpressions(baseNumber: number): void {
    if (this.digitExpressions.size) return;

    const b = baseNumber;
    this.digitExpressions.set(b, String(b));

    // 如果基础数字在1-9之间，对应数字直接使用基础数字本身
    for (let i = 1; i <= 9; i++) {
      if (i === b) continue; // 跳过基础数字本身，因为已经设置过了
      if (i <= 9) {
        this.digitExpressions.set(i, String(b === i ? b : i));
      }
    }

    // 设置需要特殊处理的数字
    this.digitExpressions.set(0, `(${b} ^ ${b})`);
    this.digitExpressions.set(10, `((${b} << ${b} / ${b}) + (${b} >> ${b} / ${b}))`);

    // 如果基础数字不是对应数字，则使用原来的表达式
    if (b !== 1) this.digitExpressions.set(1, `(${b} / ${b})`);
    if (b !== 2) this.digitExpressions.set(2, `(${b} >> (${b} / ${b})`);
    if (b !== 3) this.digitExpressions.set(3, `(${b} / (${b} / ${b} << ${b} / ${b}))`);
    if (b !== 4) this.digitExpressions.set(4, `(${b} & (${b} | (${b} / ${b})))`);
    if (b !== 5) this.digitExpressions.set(5, `(${b} - ${b} / ${b})`);
    if (b !== 6) this.digitExpressions.set(6, `(${b} + (${b} / ${b} >> ${b} / ${b}))`);
    if (b !== 7) this.digitExpressions.set(7, `(${b} + ${b} / ${b})`);
    if (b !== 8) this.digitExpressions.set(8, `(${b} + ${b} / ${b} << ${b} / ${b})`);
    if (b !== 9) this.digitExpressions.set(9, `(${b} | (${b} >> ${b} / ${b}))`);
  }

  /**
   * 获取指定数字对应的数学表达式
   * @param n - 需要获取表达式的数字
   * @param baseNumber - 用于生成表达式的基础数字
   * @returns 返回对应数字的表达式字符串
   */
  private getDigitExpr(n: number, baseNumber: number): string {
    this.initDigitExpressions(baseNumber);
    return this.digitExpressions.get(n) || String(n);
  }

  /**
   * 使用十进制形式生成目标数值的表达式
   * @param target - 目标数值
   * @param baseNumber - 基础数字
   * @returns 返回一个基于十进制的数学表达式
   */
  private generateDecimalExpression(target: number, baseNumber: number): string {
    // 处理特殊情况
    if (target === 0) return this.getDigitExpr(0, baseNumber);
    if (target === 100) return `(${this.getDigitExpr(10, baseNumber)} * ${this.getDigitExpr(10, baseNumber)})`;
    if (target <= 10) return this.getDigitExpr(target, baseNumber);

    // 处理11-99的数字
    const tens = Math.floor(target / 10);
    const ones = target % 10;

    if (tens === 1) {
      return `(${this.getDigitExpr(10, baseNumber)} + ${this.getDigitExpr(ones, baseNumber)})`;
    }
    if (ones === 0) {
      return `(${this.getDigitExpr(tens, baseNumber)} * ${this.getDigitExpr(10, baseNumber)})`;
    }
    return `((${this.getDigitExpr(tens, baseNumber)} * ${this.getDigitExpr(10, baseNumber)}) + ${this.getDigitExpr(ones, baseNumber)})`;
  }

  /**
   * 使用质因数分解的方式生成目标数值的表达式
   * @param target - 目标数值
   * @param baseNumber - 基础数字
   * @returns 返回一个基于质因数分解的数学表达式
   */
  private generatePrimeFactorsExpression(target: number, baseNumber: number): string {
    if (target <= 1) return this.generateDecimalExpression(target, baseNumber);

    // 尝试使用大数因式分解
    const tryDecompose = (num: number): number[] | null => {
      // 从大到小尝试基础数字
      for (let i = 9; i >= 2; i--) {
        if (num % i === 0) {
          const quotient = num / i;
          if (quotient <= 9) {
            return [i, quotient];
          }
          // 递归尝试分解商
          const subResult = tryDecompose(quotient);
          if (subResult) {
            return [i, ...subResult];
          }
        }
      }
      return null;
    };

    // 寻找最近的可分解数
    const findNearestDecomposable = (num: number): [number, number] => {
      let lower = num - 1;
      let upper = num + 1;

      while (lower > 1 || upper <= 100) {
        if (lower > 1 && tryDecompose(lower)) {
          return [lower, num - lower]; // 需要加上差值
        }
        if (upper <= 100 && tryDecompose(upper)) {
          return [upper, lower - upper]; // 需要减去差值
        }
        lower--;
        upper++;
      }

      return [num, 0]; // 降级为十进制表示
    };

    // 尝试直接分解
    const factors = tryDecompose(target);
    if (factors) {
      // 将因子转换为表达式并随机打乱顺序
      const factorExprs = factors
        .map(f => this.generateDecimalExpression(f, baseNumber))
        .sort(() => Math.random() - 0.5);  // 随机打乱数组顺序
      return `(${factorExprs.join(' * ')})`;
    }

    // 使用最近的可分解数
    const [base, diff] = findNearestDecomposable(target);
    if (diff === 0) {
      return this.generateDecimalExpression(target, baseNumber);
    }

    const baseExpr = this.generatePrimeFactorsExpression(base, baseNumber);
    const diffExpr = this.generateDecimalExpression(Math.abs(diff), baseNumber);

    // 根据差值是正数还是负数决定加减
    return diff > 0
      ? `(${baseExpr} + ${diffExpr})`
      : `(${baseExpr} - ${diffExpr})`;
  }

  /**
   * 根据娱乐模式设置格式化分数显示
   */
  public formatScore(score: number, date: Date, foolConfig: FoolConfig): string {
    if (foolConfig.type !== FoolMode.ENABLED ||
        (foolConfig.date && (() => {
          const [targetMonth, targetDay] = foolConfig.date.split('-').map(Number);
          return !isNaN(targetMonth) && !isNaN(targetDay) &&
                 ((date.getMonth() + 1) !== targetMonth ||
                  date.getDate() !== targetDay);
        })())) {
      return score.toString();
    }

    try {
      switch (foolConfig.displayMode) {
        case DisplayMode.BINARY:
          return score.toString(2);

        case DisplayMode.EXPRESSION: {
          const baseNumber = foolConfig.baseNumber ?? 6;
          // 随机选择使用十进制或质因数分解方式
          return Math.random() < 0.5
            ? this.generateDecimalExpression(score, baseNumber)
            : this.generatePrimeFactorsExpression(score, baseNumber);
        }

        default:
          return score.toString();
      }
    } catch (error) {
      this.ctx.logger.error('Error formatting score:', error);
      return score.toString();
    }
  }
}

import { Context } from 'koishi'
import { promises as fs } from 'fs'
import * as path from 'path'
import { EntertainmentMode, DisplayMode } from '../index';

/**
 * JRRP特殊模式处理类
 * 用于处理用户特殊代码绑定和今日人品计算规则
 */
export class JrrpSpecialMode {
  // 存储用户ID和特殊代码的映射
  private specialCodes = new Map<string, string>();
  // 记录用户是否已获得过100点
  private first100Records = new Map<string, boolean>();
  // JRRP数据存储路径
  private readonly JRRP_DATA_PATH = 'data/jrrp.json';

  /**
   * 构造函数
   * @param ctx Koishi上下文
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
        codes: Object.fromEntries(this.specialCodes),
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
   * 验证特殊代码格式是否正确
   * @param code 特殊代码
   * @returns 是否符合XXXX-XXXX-XXXX-XXXX格式(X为16进制数字)
   */
  validateSpecialCode(code: string): boolean {
    return /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/i.test(code);
  }

  /**
   * 绑定用户的特殊代码
   * @param userId 用户ID
   * @param code 特殊代码
   */
  async bindSpecialCode(userId: string, code: string): Promise<void> {
    this.specialCodes.set(userId, code.toUpperCase());
    await this.saveData();
  }

  /**
   * 移除用户的特殊代码
   * @param userId 用户ID
   */
  async removeSpecialCode(userId: string): Promise<void> {
    this.specialCodes.delete(userId);
    await this.saveData();
  }

  /**
   * 获取用户的特殊代码
   * @param userId 用户ID
   * @returns 用户绑定的特殊代码，未绑定则返回undefined
   */
  getSpecialCode(userId: string): string | undefined {
    return this.specialCodes.get(userId);
  }

  /**
   * 使用特殊代码计算JRRP值
   * @param specialCode 特殊代码
   * @param date 日期
   * @param password 密码
   * @returns JRRP值(0-100)
   */
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
    const combinedHash = (hash1 / div3 + hash2 / div3);
    const combined = Math.abs(Number(combinedHash) / 527.0);
    const num = Math.round(combined) % 1001;

    return num >= 970 ? 100 : Math.round((num / 969.0) * 99.0);
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
          this.specialCodes.set(userId, code as string)));
    }

    if (data.first100) {
      operations.push(...Object.entries(data.first100)
        .map(([userId, hadFirst100]) =>
          this.first100Records.set(userId, hadFirst100 as boolean)));
    }

    await Promise.all(operations);
  }

  /**
   * 生成一个数学表达式，其计算结果等于目标数值
   * @param target - 目标数值，表达式计算结果应等于此值
   * @returns 生成的数学表达式字符串，格式为"表达式 = 结果"
   */
  generateExpression(target: number): string {
    const operators = ['+', '-', '*', '|', '&', '^'];
    const numbers = [6];
    const maxDepth = 3;

    const generateRandomExpression = (depth: number, current: number): string => {
      if (depth >= maxDepth) {
        return current.toString();
      }

      const operator = operators[Math.floor(Math.random() * operators.length)];
      const num = numbers[Math.floor(Math.random() * numbers.length)];

      if (Math.random() < 0.5) {
        return `(${generateRandomExpression(depth + 1, current)} ${operator} ${num})`;
      } else {
        return `${num} ${operator} ${generateRandomExpression(depth + 1, current)}`;
      }
    }

    let expression = '';
    do {
      expression = generateRandomExpression(0, target);
    } while (eval(expression) !== target);

    return `${expression} = ${target}`;
  }

  /**
   * 根据娱乐模式设置格式化分数显示
   * @param score - 要格式化的分数
   * @param date - 当前日期，用于判断是否为愚人节
   * @param entertainment - 娱乐模式配置对象
   * @returns 格式化后的分数字符串
   */
  formatScore(score: number, date: Date, entertainment: { mode: EntertainmentMode, displayMode: DisplayMode }): string {
    const isEntertainmentEnabled = entertainment.mode === EntertainmentMode.ENABLED ||
      (entertainment.mode === EntertainmentMode.APRIL_FOOL &&
       date.getMonth() === 3 && date.getDate() === 1);

    if (!isEntertainmentEnabled) {
      return score.toString();
    }

    switch (entertainment.displayMode) {
      case DisplayMode.BINARY:
        return score.toString(2).padStart(7, '0');
      case DisplayMode.EXPRESSION:
        return this.generateExpression(score);
      default:
        return score.toString();
    }
  }
}

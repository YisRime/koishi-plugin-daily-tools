import { Context } from 'koishi'
import { promises as fs } from 'fs'
import { dirname } from 'path'
import { CONSTANTS } from './utils'

/**
 * QQ赞我管理器
 * 用于管理自动点赞功能的QQ账号列表，包括数据的持久化存储和点赞操作
 */
export class ZanwoManager {
  /** 存储需要自动点赞的QQ号集合 */
  private zanlists: Set<string> = new Set();
  /** 赞我数据的持久化存储路径 */
  private readonly ZANWO_DATA_PATH = 'data/zanwo.json';

  /**
   * 创建一个新的赞我管理器实例
   * @param ctx Koishi上下文对象
   */
  constructor(private ctx: Context) {
    this.loadData();
  }

  /**
   * 从文件加载已保存的赞我列表数据
   * @returns Promise<void>
   */
  private async loadData(): Promise<void> {
    try {
      const exists = await fs.access(this.ZANWO_DATA_PATH)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        const data = JSON.parse(await fs.readFile(this.ZANWO_DATA_PATH, 'utf8'));
        if (Array.isArray(data)) {
          this.zanlists = new Set(data);
        }
      }
    } catch (error) {
      this.ctx.logger.error('Failed to load zanwo data:', error);
    }
  }

  /**
   * 将当前赞我列表数据保存到文件
   * @returns Promise<void>
   */
  private async saveData(): Promise<void> {
    try {
      const dir = dirname(this.ZANWO_DATA_PATH);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.ZANWO_DATA_PATH, JSON.stringify([...this.zanlists], null, 2));
    } catch (error) {
      this.ctx.logger.error('Failed to save zanwo data:', error);
    }
  }

  /**
   * 添加一个QQ号到赞我列表
   * @param qq - 要添加的QQ号
   * @returns 添加是否成功
   */
  async addQQ(qq: string): Promise<boolean> {
    if (!/^\d+$/.test(qq)) return false;
    this.zanlists.add(qq);
    await this.saveData();
    return true;
  }

  /**
   * 从赞我列表中移除一个QQ号
   * @param qq - 要移除的QQ号
   * @returns 移除是否成功
   */
  async removeQQ(qq: string): Promise<boolean> {
    if (!this.zanlists.has(qq)) return false;
    this.zanlists.delete(qq);
    await this.saveData();
    return true;
  }

  /**
   * 获取当前赞我列表中的所有QQ号
   * @returns QQ号字符串数组
   */
  getList(): string[] {
    return [...this.zanlists];
  }

  /**
   * 向指定用户发送点赞
   * @param session - 会话上下文
   * @param targetId - 目标用户QQ号
   * @param count - 点赞次数，默认5次
   * @returns 点赞是否成功完成
   */
  async sendLikes(session, targetId: string, count: number = 5): Promise<boolean> {
    const promises = Array(count).fill(null).map(() =>
      session.bot.internal.sendLike(targetId, 10).catch(() => null)
    );

    try {
      await Promise.all([
        ...promises,
        new Promise(resolve => setTimeout(resolve, CONSTANTS.TIMEOUTS.LIKE_DELAY))
      ]);
      return true;
    } catch {
      return false;
    }
  }
}

import { Context } from 'koishi'
import { promises as fs } from 'fs'
import { dirname } from 'path'
import { CONSTANTS } from './utils'

/**
 * 赞我管理器
 * 用于管理自动点赞功能的账号列表，包括数据的持久化存储和点赞操作
 */
export class ZanwoManager {
  /** 存储需要自动点赞的ID集合 */
  private likeTargets: Set<string> = new Set();
  /** 赞我数据的持久化存储路径 */
  private readonly LIKE_DATA_PATH = 'data/zanwo.json';

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
      const exists = await fs.access(this.LIKE_DATA_PATH)
        .then(() => true)
        .catch(() => false);

      if (exists) {
        const data = JSON.parse(await fs.readFile(this.LIKE_DATA_PATH, 'utf8'));
        if (Array.isArray(data)) {
          this.likeTargets = new Set(data);
        }
      }
    } catch (error) {
      this.ctx.logger.error('Failed to load like data:', error);
    }
  }

  /**
   * 将当前赞我列表数据保存到文件
   * @returns Promise<void>
   */
  private async saveData(): Promise<void> {
    try {
      const dir = dirname(this.LIKE_DATA_PATH);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.LIKE_DATA_PATH, JSON.stringify([...this.likeTargets], null, 2));
    } catch (error) {
      this.ctx.logger.error('Failed to save like data:', error);
    }
  }

  /**
   * 添加一个ID到赞我列表
   * @param target - 要添加的ID
   * @returns 添加是否成功
   */
  async addQQ(target: string): Promise<boolean> {
    if (!/^\d+$/.test(target)) return false;
    this.likeTargets.add(target);
    await this.saveData();
    return true;
  }

  /**
   * 从赞我列表中移除一个ID
   * @param target - 要移除的ID
   * @returns 移除是否成功
   */
  async removeQQ(target: string): Promise<boolean> {
    if (!this.likeTargets.has(target)) return false;
    this.likeTargets.delete(target);
    await this.saveData();
    return true;
  }

  /**
   * 获取当前赞我列表中的所有ID
   * @returns ID字符串数组
   */
  getList(): string[] {
    return [...this.likeTargets];
  }

  /**
   * 向指定用户发送点赞
   * @param session - 会话上下文
   * @param targetId - 目标用户ID
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

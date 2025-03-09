import { Context } from 'koishi'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { BindData, BindingService } from '../types'

export function createBindingService(ctx: Context, bindDataFile: string): BindingService {
  return {
    async load(): Promise<BindData> {
      try {
        if (!existsSync(bindDataFile)) {
          const initialData: BindData = { group: {}, private: {} }
          await writeFile(bindDataFile, JSON.stringify(initialData, null, 2), 'utf8')
          return initialData
        }
        const data = await readFile(bindDataFile, 'utf8')
        return JSON.parse(data)
      } catch (error) {
        ctx.logger.error('加载绑定数据失败:', error)
        return { group: {}, private: {} }
      }
    },

    async save(data: BindData): Promise<void> {
      try {
        await writeFile(bindDataFile, JSON.stringify(data, null, 2), 'utf8')
      } catch (error) {
        ctx.logger.error('保存绑定数据失败:', error)
      }
    },

    async bind(userId: string, channelId: string | undefined, name: string, isGroup: boolean): Promise<void> {
      const data = await this.load()

      if (isGroup && channelId) {
        if (!data.group[channelId]) data.group[channelId] = {}
        data.group[channelId][userId] = name
      } else {
        data.private[userId] = name
      }

      await this.save(data)
    },

    async unbind(userId: string, channelId: string | undefined, isGroup: boolean): Promise<boolean> {
      const data = await this.load()
      let unbound = false

      if (isGroup && channelId) {
        if (data.group[channelId]?.[userId]) {
          delete data.group[channelId][userId]
          unbound = true
        }
      } else if (data.private[userId]) {
        delete data.private[userId]
        unbound = true
      }

      await this.save(data)
      return unbound
    },

    async getName(userId: string, channelId: string | undefined, isGroup: boolean): Promise<string | null> {
      const data = await this.load()

      if (isGroup && channelId) {
        return data.group[channelId]?.[userId] || null
      } else {
        return data.private[userId] || null
      }
    }
  }
}

import { Context } from 'koishi'
import { resolve } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'

// ============= 类型定义 =============

export interface DailyToolsConfig {
  ddrCacheTime: number
  ddrReply: boolean
  puppeteerService: string
  showExtendedStats: boolean
  customTemplate: string
  debugMode: boolean
}

export interface CacheService {
  get(key: string): Promise<Buffer | null>
  set(key: string, data: Buffer): Promise<void>
  getAge(key: string): number | null
}

export interface BindData {
  group: Record<string, Record<string, string>>
  private: Record<string, string>
}

export interface BindingService {
  load(): Promise<BindData>
  save(data: BindData): Promise<void>
  bind(userId: string, channelId: string | undefined, name: string, isGroup: boolean): Promise<void>
  unbind(userId: string, channelId: string | undefined, isGroup: boolean): Promise<boolean>
  getName(userId: string, channelId: string | undefined, isGroup: boolean): Promise<string | null>
}

export interface PlayerDetailedData {
  player: string
  points?: {
    total: number
    points: number
    rank: number | string
  }
  team_rank?: {
    rank: number | string
    points: number
  }
  rank?: {
    rank: number | string
    points: number
  }
  country?: {
    name: string
    code: string
  }
  total_finishes?: number
  first_finishes?: number
  maps_played?: number
  joined_date?: string
  clan_tag?: string
  favorite_server?: {
    server: string
    total_finishes: number
  }
  points_last_month?: {
    points: number
    rank: number | string
  }
  points_last_week?: {
    points: number
    rank: number | string
  }
  last_finishes?: any[]
  favorite_partners?: any[]
  favorite_maps?: any[]
  best_ranks?: any[]
  country_rank?: {
    rank: number | string
    total_players: number
  }
  type_points?: Record<string, number>
  type_ranks?: Record<string, number | string>
  activity?: {
    weekly?: number[]
    monthly?: number[]
  }
}

export interface HTMLRenderer {
  html2image(htmlContent: string): Promise<Buffer>
  renderPlayerStats(playerData: PlayerDetailedData): Promise<Buffer>
}

// ============= 缓存服务实现 =============

export function createCacheService(ctx: Context, config: DailyToolsConfig, cacheDir: string): CacheService {
  return {
    async get(key: string): Promise<Buffer | null> {
      try {
        const cachePath = resolve(cacheDir, `${key}.cache`)
        const metaPath = resolve(cacheDir, `${key}.meta`)

        if (!existsSync(cachePath) || !existsSync(metaPath)) {
          return null
        }

        const meta = JSON.parse(await readFile(metaPath, 'utf8'))
        const now = Date.now()

        if (config.ddrCacheTime > 0 && (now - meta.timestamp) > config.ddrCacheTime * 60 * 1000) {
          return null
        }

        return await readFile(cachePath)
      } catch (error) {
        ctx.logger.error(`缓存读取错误:`, error)
        return null
      }
    },

    async set(key: string, data: Buffer): Promise<void> {
      try {
        const cachePath = resolve(cacheDir, `${key}.cache`)
        const metaPath = resolve(cacheDir, `${key}.meta`)
        const meta = { timestamp: Date.now() }

        await writeFile(cachePath, data)
        await writeFile(metaPath, JSON.stringify(meta), 'utf8')
      } catch (error) {
        ctx.logger.error(`缓存写入错误:`, error)
      }
    },

    getAge(key: string): number | null {
      try {
        const metaPath = resolve(cacheDir, `${key}.meta`)
        if (!existsSync(metaPath)) return null;

        const meta = JSON.parse(require('fs').readFileSync(metaPath, 'utf8'))
        return Math.floor((Date.now() - meta.timestamp) / (60 * 1000))
      } catch (error) {
        ctx.logger.error(`缓存元数据读取错误:`, error)
        return null
      }
    }
  }
}

// ============= 绑定服务实现 =============

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

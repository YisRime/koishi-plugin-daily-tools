import { Context } from 'koishi'
import { resolve } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { CacheService, DailyToolsConfig } from '../types'

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

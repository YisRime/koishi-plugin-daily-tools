import { Context, Schema, h } from 'koishi'
import {} from 'koishi-plugin-puppeteer'
import { resolve } from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import axios from 'axios'

export const name = 'daily-tools'

export interface Config {
  ddrCacheTime: number
  ddrReply: boolean
  puppeteerService: string
}

export const Config: Schema<Config> = Schema.object({
  ddrCacheTime: Schema.number().default(240).description('DDRace 数据缓存时间（分钟），设为 0 表示不使用缓存'),
  ddrReply: Schema.boolean().default(true).description('是否使用回复模式发送DDRace消息'),
  puppeteerService: Schema.string().default('puppeteer').description('使用的浏览器渲染服务名称')
})

// 声明插件依赖
export const inject = ['puppeteer']

// 常量定义
const BASE_URL = 'https://ddnet.tw'
const PLAYER_JSON_URL = `${BASE_URL}/players/?json2=`;

// 工具类型定义
interface BindData {
  group: Record<string, Record<string, string>>
  private: Record<string, string>
}

// DDRace详细玩家数据格式
interface PlayerDetailedData {
  player: string
  points: {
    total: number
    points: number
    rank: number
  }
  team_rank: {
    points: number
    rank: number
  }
  rank: {
    points: number
    rank: number
  }
  points_last_month?: {
    points: number
    rank: number
  }
  favorite_server?: {
    server: string
  }
  last_finishes?: Array<{
    timestamp: number
    map: string
    time: number
    country: string
    type: string
  }>
  favorite_partners?: Array<{
    name: string
    finishes: number
  }>
}

export function apply(ctx: Context, config: Config) {
  // 路径定义
  const dataDir = resolve(ctx.baseDir, 'data/daily-tools')
  const cacheDir = resolve(dataDir, 'cache')
  const configDir = resolve(dataDir, 'config')
  const templatesDir = resolve(dataDir, 'templates')
  const bindDataFile = resolve(dataDir, 'ddr-bind.json')
  const playerTemplateFile = resolve(templatesDir, 'player-stats.html')

  // 初始化插件
  const initPlugin = async () => {
    try {
      // 创建必要目录
      for (const dir of [dataDir, cacheDir, configDir, templatesDir]) {
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true })
          ctx.logger.info(`创建目录: ${dir}`)
        }
      }

      // 创建默认模板文件
      if (!existsSync(playerTemplateFile)) {
        const defaultTemplate = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>DDRace Player Stats</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 0;
              padding: 20px;
              background-color: #f5f5f5;
            }
            .container {
              background-color: white;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              padding: 20px;
              max-width: 800px;
              margin: 0 auto;
            }
            .header {
              background-color: #4a76a8;
              color: white;
              padding: 15px;
              border-radius: 6px 6px 0 0;
              margin: -20px -20px 20px;
              text-align: center;
            }
            .stats {
              display: flex;
              justify-content: space-between;
              flex-wrap: wrap;
              margin-bottom: 20px;
            }
            .stat-item {
              text-align: center;
              padding: 10px;
              flex: 1;
              border-radius: 5px;
              background-color: #f9f9f9;
              margin: 5px;
              min-width: 120px;
            }
            .stat-value {
              font-size: 24px;
              font-weight: bold;
              color: #4a76a8;
            }
            .stat-label {
              color: #666;
              font-size: 14px;
            }
            .section {
              margin: 20px 0;
              padding: 15px;
              background-color: #fafafa;
              border-radius: 5px;
            }
            .section-title {
              font-size: 18px;
              font-weight: bold;
              color: #333;
              margin-bottom: 10px;
              border-bottom: 1px solid #eee;
              padding-bottom: 5px;
            }
            .partner-item, .finish-item {
              display: flex;
              justify-content: space-between;
              padding: 5px 10px;
              border-bottom: 1px solid #f0f0f0;
            }
            .finish-item {
              flex-wrap: wrap;
            }
            .finish-item > div {
              margin-right: 10px;
            }
            .finish-map {
              font-weight: bold;
              min-width: 120px;
            }
            .footer {
              text-align: center;
              color: #999;
              font-size: 12px;
              margin-top: 20px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>{{playerName}} - DDRace 统计</h2>
            </div>
            <div class="stats">
              <div class="stat-item">
                <div class="stat-value">{{points}}</div>
                <div class="stat-label">总分</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">{{playerRank}}</div>
                <div class="stat-label">个人排名</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">{{teamRank}}</div>
                <div class="stat-label">团队排名</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">{{totalPoints}}</div>
                <div class="stat-label">全部点数</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">{{favoriteServer}}</div>
                <div class="stat-label">常用服务器</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">{{monthlyPoints}}</div>
                <div class="stat-label">本月得分</div>
              </div>
            </div>

            {{#if lastFinishes}}
            <div class="section">
              <div class="section-title">最近完成 ({{lastFinishesCount}})</div>
              {{#each lastFinishes}}
              <div class="finish-item">
                <div class="finish-map">{{map}}</div>
                <div>{{time}}s</div>
                <div>{{country}}</div>
                <div>{{type}}</div>
              </div>
              {{/each}}
            </div>
            {{/if}}

            {{#if favoritePartners}}
            <div class="section">
              <div class="section-title">常见队友 ({{partnerCount}})</div>
              {{#each favoritePartners}}
              <div class="partner-item">
                <div>{{name}}</div>
                <div>{{finishes}} 次完成</div>
              </div>
              {{/each}}
            </div>
            {{/if}}

            <div class="footer">
              由 daily-tools DDRace 查询功能生成
            </div>
          </div>
        </body>
        </html>
        `
        await writeFile(playerTemplateFile, defaultTemplate, 'utf8')
        ctx.logger.info(`创建模板文件: ${playerTemplateFile}`)
      }

      // 初始化绑定数据文件
      if (!existsSync(bindDataFile)) {
        const initialData: BindData = { group: {}, private: {} }
        await writeFile(bindDataFile, JSON.stringify(initialData, null, 2), 'utf8')
      }

      return true
    } catch (error) {
      ctx.logger.error('插件初始化失败:', error)
      return false
    }
  }

  // 绑定数据操作
  const bindData = {
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
    }
  }

  // 缓存操作
  const cache = {
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

  // API 数据获取
  const api = {
    async fetchPlayer(name: string): Promise<PlayerDetailedData | null> {
      try {
        const response = await axios.get(`${PLAYER_JSON_URL}${encodeURIComponent(name)}`, { timeout: 10000 })

        if (typeof response.data === 'object' && response.data !== null && 'player' in response.data) {
          return response.data as PlayerDetailedData
        }

        if (Array.isArray(response.data) && response.data.length > 0) {
          return response.data[0] as PlayerDetailedData
        }

        return null
      } catch (error) {
        ctx.logger.error(`获取玩家数据失败:`, error)
        return null
      }
    }
  }

  // HTML渲染
  const renderer = {
    async html2image(htmlContent: string): Promise<Buffer> {
      const puppeteer = ctx.get('puppeteer')
      if (!puppeteer) {
        throw new Error('浏览器渲染服务不可用')
      }

      try {
        // 尝试不同的 API 方法
        const possibleMethods = ['render', 'renderHTML', 'snapshot', 'renderToBuffer']
        for (const method of possibleMethods) {
          if (typeof (puppeteer as any)[method] === 'function') {
            return await (puppeteer as any)[method](htmlContent, {
              viewport: { width: 800, height: 600 },
              type: 'png',
              fullPage: true
            })
          }
        }
        throw new Error('找不到可用的渲染方法')
      } catch (e) {
        ctx.logger.error('HTML 渲染失败:', e)
        throw new Error(`HTML 渲染失败: ${e.message}`)
      }
    },

    async renderPlayerStats(playerData: PlayerDetailedData): Promise<Buffer> {
      if (!playerData) {
        throw new Error('无效的玩家数据')
      }

      try {
        // 读取模板
        const template = await readFile(playerTemplateFile, 'utf8')

        // 替换基本数据
        const name = playerData.player || 'Unknown'
        const points = playerData.points?.points || 0
        const totalPoints = playerData.points?.total || 0
        const playerRank = playerData.points?.rank || 'N/A'
        const teamRank = playerData.team_rank?.rank || 'N/A'
        const favoriteServer = playerData.favorite_server?.server || 'N/A'
        const monthlyPoints = playerData.points_last_month?.points || 0

        // 处理最近完成和常见队友数据
        const lastFinishes = playerData.last_finishes?.slice(0, 5) || []
        const favoritePartners = playerData.favorite_partners?.slice(0, 5) || []

        // 替换模板变量
        let html = template
          .replace(/{{playerName}}/g, name)
          .replace(/{{points}}/g, String(points))
          .replace(/{{totalPoints}}/g, String(totalPoints))
          .replace(/{{playerRank}}/g, String(playerRank))
          .replace(/{{teamRank}}/g, String(teamRank))
          .replace(/{{favoriteServer}}/g, favoriteServer)
          .replace(/{{monthlyPoints}}/g, String(monthlyPoints))

        // 处理最近完成部分
        if (lastFinishes.length > 0) {
          html = html.replace(/{{#if lastFinishes}}([\s\S]*?){{\/if}}/g, '$1')
            .replace(/{{lastFinishesCount}}/g, String(lastFinishes.length))

          let finishesHtml = ''
          for (const finish of lastFinishes) {
            finishesHtml += `<div class="finish-item">
              <div class="finish-map">${finish.map}</div>
              <div>${finish.time.toFixed(2)}s</div>
              <div>${finish.country}</div>
              <div>${finish.type}</div>
            </div>`
          }
          html = html.replace(/{{#each lastFinishes}}[\s\S]*?{{\/each}}/g, finishesHtml)
        } else {
          html = html.replace(/{{#if lastFinishes}}[\s\S]*?{{\/if}}/g, '')
        }

        // 处理队友部分
        if (favoritePartners.length > 0) {
          html = html.replace(/{{#if favoritePartners}}([\s\S]*?){{\/if}}/g, '$1')
            .replace(/{{partnerCount}}/g, String(favoritePartners.length))

          let partnersHtml = ''
          for (const partner of favoritePartners) {
            partnersHtml += `<div class="partner-item">
              <div>${partner.name}</div>
              <div>${partner.finishes} 次完成</div>
            </div>`
          }
          html = html.replace(/{{#each favoritePartners}}[\s\S]*?{{\/each}}/g, partnersHtml)
        } else {
          html = html.replace(/{{#if favoritePartners}}[\s\S]*?{{\/if}}/g, '')
        }

        // 渲染HTML为图片
        return await this.html2image(html)
      } catch (error) {
        ctx.logger.error('渲染玩家数据失败:', error)
        throw new Error(`渲染失败: ${error.message}`)
      }
    }
  }

  // 初始化插件
  initPlugin().catch(err => ctx.logger.error('插件初始化失败:', err))

  // 注册命令
  const ddr = ctx.command('ddr', 'DDRace 游戏相关功能')
    .usage('示例: ddr <玩家名称>')
    .action(async ({ session }, name) => {
      if (!name) return '请提供玩家名称'

      const userId = session?.userId
      const channelId = session?.channelId

      if (!userId) return '无法获取用户信息'

      // 先尝试验证玩家是否存在
      try {
        const playerData = await api.fetchPlayer(name)
        if (!playerData) {
          return `未找到玩家 "${name}"，请检查名称是否正确`
        }

        // 使用API返回的标准名称
        const standardName = playerData.player || name

        const data = await bindData.load()

        if (session.subtype === 'group' && channelId) {
          if (!data.group[channelId]) data.group[channelId] = {}
          data.group[channelId][userId] = standardName
        } else {
          data.private[userId] = standardName
        }

        await bindData.save(data)
        return `已成功绑定玩家名称：${standardName}`
      } catch (error) {
        ctx.logger.error('玩家绑定验证失败:', error)
        // 出错时仍然允许绑定，但使用原始名称
        const data = await bindData.load()

        if (session.subtype === 'group' && channelId) {
          if (!data.group[channelId]) data.group[channelId] = {}
          data.group[channelId][userId] = name
        } else {
          data.private[userId] = name
        }

        await bindData.save(data)
        return `已绑定玩家名称：${name}（警告：无法验证此玩家是否存在）`
      }
    })

  // 查询玩家分数
  ddr.subcommand('.rank', '查询 DDRace 玩家分数')
    .option('force', '-f 强制刷新缓存')
    .usage('示例: ddr.rank <玩家名称>')
    .action(async ({ session, options }, name) => {
      const userId = session?.userId
      const channelId = session?.channelId

      // 如果没提供名字，尝试使用绑定的名字
      if (!name) {
        if (!userId || !channelId) return '无法获取用户信息，请提供玩家名称'

        const data = await bindData.load()
        const playerName = session.subtype === 'group'
          ? data.group[channelId]?.[userId]
          : data.private[userId]

        if (!playerName) {
          return '你还没有绑定玩家名称，请使用 ddr <玩家名称> 进行绑定'
        }

        name = playerName
      }

      const cacheKey = `player_${name}`

      // 检查缓存
      if (!options.force) {
        const cachedImage = await cache.get(cacheKey)
        if (cachedImage) {
          const cacheAge = cache.getAge(cacheKey)
          const cacheInfo = `\n数据缓存于${cacheAge}分钟前`

          return h('message', [
            h.text(`${name} 的成绩信息如下：`),
            h.image(cachedImage, 'image/png'),
            h.text(`${cacheInfo}\n使用 ddr.r -f ${name} 强制刷新`)
          ])
        }
      }

      await session?.send('正在查询玩家数据，请稍候...')

      // 获取新数据
      try {
        const playerData = await api.fetchPlayer(name)
        if (!playerData) return `没找到玩家 "${name}" 的数据，请检查名称是否正确`

        const imageData = await renderer.renderPlayerStats(playerData)
        await cache.set(cacheKey, imageData)

        return h('message', [
          h.text(`${name} 的成绩信息如下：`),
          h.image(imageData, 'image/png'),
          h.text(`\n查询完成 (${new Date().toLocaleTimeString()})`)
        ])
      } catch (error) {
        return `查询失败：${error.message || '未知错误'}`
      }
    })

  // 解绑玩家名称
  ddr.subcommand('.unbind', '解除绑定的 DDRace 玩家名称')
    .action(async ({ session }) => {
      const userId = session?.userId
      const channelId = session?.channelId

      if (!userId) return '无法获取用户信息'

      const data = await bindData.load()
      let unbound = false

      if (session.subtype === 'group' && channelId) {
        if (data.group[channelId]?.[userId]) {
          delete data.group[channelId][userId]
          unbound = true
        }
      } else if (data.private[userId]) {
        delete data.private[userId]
        unbound = true
      }

      await bindData.save(data)
      return unbound ? '解绑成功' : '你尚未绑定任何玩家名称'
    })
}

import { Context } from 'koishi'
import { readFile } from 'fs/promises'
import { HTMLRenderer, PlayerDetailedData, DailyToolsConfig } from './services'

// 工具函数：格式化时间戳为日期字符串
function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// 工具函数：准备安全的玩家数据
function preparePlayerData(playerData: PlayerDetailedData) {
  if (!playerData) {
    // 创建一个最小数据结构，避免空值错误
    return {
      name: 'Unknown',
      points: 0,
      totalPoints: 0,
      playerRank: 'N/A',
      teamRank: 'N/A',
      favoriteServer: 'N/A',
      serverFinishes: 0,
      monthlyPoints: 0,
      monthlyRank: 'N/A',
      weeklyPoints: 0,
      weeklyRank: 'N/A',
      country: 'Unknown',
      countryCode: '',
      totalFinishes: 0,
      firstFinishes: 0,
      mapsPlayed: 0,
      joinDate: '-',
      clanTag: '',
      lastFinishes: [],
      favoritePartners: [],
      favoriteMaps: [],
      bestRanks: [],
      hasLastFinishes: false,
      hasFavoritePartners: false,
      hasFavoriteMaps: false,
      hasBestRanks: false,
      hasCountryRank: false,
      countryRank: 'N/A',
      countryTotalPlayers: 0,
      typePoints: {},
      typeRanks: {},
      hasActivity: false,
      weeklyActivity: [],
      monthlyActivity: []
    }
  }

  // 基本信息
  const data = {
    name: playerData.player || 'Unknown',
    points: playerData.points?.points ?? 0,
    totalPoints: playerData.points?.total ?? 0,
    playerRank: playerData.points?.rank ?? 'N/A',
    teamRank: playerData.team_rank?.rank ?? 'N/A',
    favoriteServer: playerData.favorite_server?.server ?? 'N/A',
    serverFinishes: playerData.favorite_server?.total_finishes ?? 0,
    monthlyPoints: playerData.points_last_month?.points ?? 0,
    monthlyRank: playerData.points_last_month?.rank ?? 'N/A',
    weeklyPoints: playerData.points_last_week?.points ?? 0,
    weeklyRank: playerData.points_last_week?.rank ?? 'N/A',
    country: playerData.country?.name ?? 'Unknown',
    countryCode: playerData.country?.code ?? '',
    totalFinishes: playerData.total_finishes ?? 0,
    firstFinishes: playerData.first_finishes ?? 0,
    mapsPlayed: playerData.maps_played ?? 0,
    joinDate: playerData.joined_date || '-',
    clanTag: playerData.clan_tag || '',

    // 数组安全复制
    lastFinishes: Array.isArray(playerData.last_finishes) ? playerData.last_finishes.slice(0, 10) : [],
    favoritePartners: Array.isArray(playerData.favorite_partners) ? playerData.favorite_partners.slice(0, 5) : [],
    favoriteMaps: Array.isArray(playerData.favorite_maps) ? playerData.favorite_maps.slice(0, 5) : [],
    bestRanks: Array.isArray(playerData.best_ranks) ? playerData.best_ranks.slice(0, 5) : [],

    // 状态标志
    hasLastFinishes: Array.isArray(playerData.last_finishes) && playerData.last_finishes.length > 0,
    hasFavoritePartners: Array.isArray(playerData.favorite_partners) && playerData.favorite_partners.length > 0,
    hasFavoriteMaps: Array.isArray(playerData.favorite_maps) && playerData.favorite_maps.length > 0,
    hasBestRanks: Array.isArray(playerData.best_ranks) && playerData.best_ranks.length > 0,
    hasCountryRank: !!playerData.country_rank,

    // 扩展数据
    countryRank: playerData.country_rank?.rank ?? 'N/A',
    countryTotalPlayers: playerData.country_rank?.total_players ?? 0,
    typePoints: playerData.type_points || {},
    typeRanks: playerData.type_ranks || {},

    // 活动数据
    hasActivity: false,
    weeklyActivity: [],
    monthlyActivity: []
  }

  // 活动数据
  data.hasActivity = !!(playerData.activity &&
    ((Array.isArray(playerData.activity.weekly) && playerData.activity.weekly.length > 0) ||
    (Array.isArray(playerData.activity.monthly) && playerData.activity.monthly.length > 0)))

  data.weeklyActivity = Array.isArray(playerData.activity?.weekly) ? playerData.activity.weekly : []
  data.monthlyActivity = Array.isArray(playerData.activity?.monthly) ? playerData.activity.monthly : []

  return data
}

export function createHTMLRenderer(ctx: Context, config: DailyToolsConfig, playerTemplateFile: string): HTMLRenderer {
  // 处理模板变量的工具函数
  const templateUtils = {
    // 安全替换模板中的简单变量
    replaceVars(html: string, vars: Record<string, string|number>): string {
      if (!html) return '' // 防止html为undefined

      try {
        Object.entries(vars).forEach(([key, value]) => {
          if (html && key) { // 额外检查，确保html和key都不是undefined
            html = html.replace(new RegExp(`{{${key}}}`, 'g'), String(value || ''))
          }
        })
      } catch (error) {
        ctx.logger.error('模板变量替换失败:', error)
      }
      return html || '' // 确保返回字符串
    },

    // 处理条件块
    processIf(html: string, varName: string, condition: boolean): string {
      if (!html || !varName) return html || '' // 防止空值

      try {
        const regex = new RegExp(`{{#if\\s+${varName}}}([\\s\\S]*?){{/if(?:\\s+${varName})?}}`, 'g')
        return condition ? html.replace(regex, '$1') : html.replace(regex, '')
      } catch (error) {
        ctx.logger.error(`处理条件块失败 (${varName}):`, error)
        return html // 出错时返回原始字符串
      }
    },

    // 处理循环块
    processEach(html: string, arrayName: string, items: any[]): string {
      if (!html || !arrayName || !items) return html || '' // 防止空值

      try {
        const regex = new RegExp(`{{#each\\s+${arrayName}}}([\\s\\S]*?){{/each}}`, 'g')
        const match = html.match(regex)

        if (!match || !items?.length) {
          return html.replace(regex, '')
        }

        const template = match[1]
        let result = ''

        items.forEach(item => {
          if (!item) return // 跳过空值

          let itemHtml = template
          Object.entries(item).forEach(([key, val]) => {
            if (key) { // 检查键是否有效
              itemHtml = itemHtml.replace(new RegExp(`{{${key}}}`, 'g'), String(val || ''))
            }
          })
          result += itemHtml
        })

        return html.replace(regex, result)
      } catch (error) {
        ctx.logger.error(`处理循环块失败 (${arrayName}):`, error)
        return html // 出错时返回原始字符串
      }
    },

    // 清理未处理的模板标签
    cleanupTemplate(html: string): string {
      if (!html) return '' // 防止空值

      try {
        // 修正常见错误
        html = html.replace(/{{\/eachj}}/g, '{{/each}}')
          .replace(/{{ttype}}/g, '{{type}}')
          .replace(/{{t{map}}}/g, '{{map}}')
          .replace(/{{t\/if}}/g, '{{/if}}')

        // 删除未处理的标签
        html = html.replace(/{{#\w+}}[\s\S]*?{{\/\w+}}/g, '')
          .replace(/{{.*?}}/g, '')

        return html
      } catch (error) {
        ctx.logger.error('清理模板标签失败:', error)
        return html || '' // 出错时尽量返回原始字符串
      }
    }
  }

  return {
    // 将HTML转为图片的功能
    async html2image(htmlContent: string): Promise<Buffer> {
      try {
        const puppeteer = ctx.get(config.puppeteerService)
        if (!puppeteer) throw new Error(`浏览器服务 "${config.puppeteerService}" 不可用`)

        const page = await puppeteer.page()
        await page.setContent(htmlContent)
        await page.setViewport({ width: 1000, height: 1200 })

        await page.evaluate(() => new Promise<void>(resolve => {
          const isComplete = document.readyState === 'complete'
          isComplete ? setTimeout(resolve, 1500) : window.addEventListener('load', () => setTimeout(resolve, 1500))
        }))

        const buffer = await page.screenshot({ fullPage: true, type: 'png' })
        await page.close()
        return buffer
      } catch (e) {
        ctx.logger.error('HTML渲染失败:', e)
        throw new Error(`HTML渲染失败: ${e.message}`)
      }
    },

    // 渲染玩家统计数据
    async renderPlayerStats(playerData: PlayerDetailedData): Promise<Buffer> {
      // 增强错误处理
      if (!playerData) {
        ctx.logger.warn('尝试渲染无效的玩家数据，使用默认数据')
        playerData = {
          player: 'Unknown Player',
          points: { total: 0, points: 0, rank: -1 },
          team_rank: { rank: -1, points: 0 },
          rank: { rank: -1, points: 0 }
        } as unknown as PlayerDetailedData
      }

      try {
        // 读取模板，添加错误处理
        let template: string
        try {
          template = await readFile(playerTemplateFile, 'utf8')
          if (!template) throw new Error('模板文件为空')
        } catch (error) {
          ctx.logger.error('读取模板文件失败:', error)
          template = '<html><body><h1>模板加载失败</h1><p>无法加载玩家统计模板</p></body></html>'
        }

        ctx.logger.debug('处理玩家数据进行渲染:', { player: playerData.player })

        // 准备安全的数据对象 - 使用独立工具函数，不通过this调用
        const data = preparePlayerData(playerData)

        // 处理模板
        let html = template || ''

        try {
          // 1. 替换基本变量
          html = templateUtils.replaceVars(html, {
            playerName: data.name,
            clanTag: data.clanTag,
            points: data.points,
            totalPoints: data.totalPoints,
            playerRank: data.playerRank,
            rank: data.playerRank,
            teamRank: data.teamRank,
            favoriteServer: data.favoriteServer,
            serverFinishes: data.serverFinishes,
            monthlyPoints: data.monthlyPoints,
            monthlyRank: data.monthlyRank,
            weeklyPoints: data.weeklyPoints,
            weeklyRank: data.weeklyRank,
            country: data.country,
            countryCode: data.countryCode,
            countryFlag: data.countryCode ? `https://ddnet.org/countryflags/${data.countryCode}.png` : '',
            totalFinishes: data.totalFinishes,
            firstFinishes: data.firstFinishes,
            mapsPlayed: data.mapsPlayed,
            joinDate: data.joinDate,
            showExtendedStats: config.showExtendedStats ? 'true' : 'false'
          })

          // 2. 处理条件块
          html = templateUtils.processIf(html, 'extendedStats', config.showExtendedStats)
          html = templateUtils.processIf(html, 'lastFinishes', data.hasLastFinishes)
          html = templateUtils.processIf(html, 'favoritePartners', data.hasFavoritePartners)
          html = templateUtils.processIf(html, 'favoriteMaps', data.hasFavoriteMaps)
          html = templateUtils.processIf(html, 'bestRanks', data.hasBestRanks)

          // 3. 处理活动数据
          if (data.hasActivity) {
            html = html.replace(/{{hasActivity}}/g, 'true')
              .replace(/{{weeklyActivityData}}/g, JSON.stringify(data.weeklyActivity || []))
              .replace(/{{monthlyActivityData}}/g, JSON.stringify(data.monthlyActivity || []))
          } else {
            html = html.replace(/{{hasActivity}}/g, 'false')
          }

          // 4. 处理循环数据
          // 地图类型数据
          if (Object.keys(data.typePoints).length > 0) {
            let typePointsHtml = ''
            Object.entries(data.typePoints).forEach(([type, points]) => {
              const rank = data.typeRanks[type] || 'N/A'
              typePointsHtml += `<div class="map-type-item">
                <div class="map-type-name">${type}</div>
                <div class="map-type-stats">
                  <span>${points}分</span>
                  <span>排名: ${rank}</span>
                </div>
              </div>`
            })
            html = html.replace(/{{typePointsContent}}/g, typePointsHtml)
          } else {
            html = html.replace(/{{typePointsContent}}/g, '<div class="no-data">无地图类型数据</div>')
          }

          // 准备最近完成数据
          const finishItems = data.lastFinishes.map(finish => ({
            map: finish.map || 'Unknown',
            time: typeof finish.time === 'number' ? `${finish.time.toFixed(2)}s` : '-',
            type: finish.type || '普通',
            country: finish.country || '-',
            date: finish.timestamp ? formatDate(finish.timestamp) : '-', // 使用外部工具函数
            points: finish.map_points ? `${finish.map_points}分` : '-'
          }))
          html = templateUtils.processEach(html, 'lastFinishes', finishItems)
          html = html.replace(/{{lastFinishesCount}}/g, String(finishItems.length))

          // 准备队友数据
          const partnerItems = data.favoritePartners.map(partner => ({
            name: partner.name || 'Unknown',
            finishes: partner.finishes || 0,
            country: partner.country || ''
          }))
          html = templateUtils.processEach(html, 'favoritePartners', partnerItems)
          html = html.replace(/{{partnerCount}}/g, String(partnerItems.length))

          // 准备喜爱地图数据
          let mapsHtml = ''
          data.favoriteMaps.forEach(map => {
            mapsHtml += `<div class="flex-item">
              <div class="flex-item-name">${map.name || 'Unknown'}</div>
              <div class="flex-item-stat">${map.finishes || 0} 次完成</div>
              ${map.points ? `<div class="flex-item-stat">${map.points} 分</div>` : ''}
            </div>`
          })
          html = html.replace(/{{favoriteMapsContent}}/g, mapsHtml)
          html = html.replace(/{{favoriteMapCount}}/g, String(data.favoriteMaps.length))

          // 准备最佳排名数据
          let ranksHtml = ''
          data.bestRanks.forEach(rank => {
            const dateStr = rank.timestamp ? formatDate(rank.timestamp) : '-' // 使用外部工具函数
            ranksHtml += `<div class="rank-item">
              <div class="rank-map">${rank.map || 'Unknown'}</div>
              <div class="rank-position">第${rank.rank || '?'}名</div>
              <div class="rank-time">${typeof rank.time === 'number' ? rank.time.toFixed(2) : '-'}s</div>
              <div class="rank-date">${dateStr}</div>
            </div>`
          })
          html = html.replace(/{{bestRanksContent}}/g, ranksHtml)
          html = html.replace(/{{bestRanksCount}}/g, String(data.bestRanks.length))

          // 国家排名数据
          if (data.hasCountryRank) {
            html = html.replace(/{{hasCountryRank}}/g, 'true')
              .replace(/{{countryRank}}/g, String(data.countryRank))
              .replace(/{{countryTotalPlayers}}/g, String(data.countryTotalPlayers))
          } else {
            html = html.replace(/{{hasCountryRank}}/g, 'false')
          }

          // 5. 处理不可用的数据
          html = html
            .replace(/{{hasMapProgress}}/g, 'false')
            .replace(/{{mapProgressContent}}/g, '<div class="no-data">无地图进度数据</div>')
            .replace(/{{hasRankHistory}}/g, 'false')
            .replace(/{{hasRecords}}/g, 'false')
            .replace(/{{firstFinishesContent}}/g, '<div class="no-data">无首次完成记录</div>')
            .replace(/{{fastestFinishesContent}}/g, '<div class="no-data">无最快完成记录</div>')
            .replace(/{{hasAchievements}}/g, 'false')
            .replace(/{{hasPlayingTime}}/g, 'false')
            .replace(/{{hasLongestStreak}}/g, 'false')

          // 6. 清理未处理的模板标签
          html = templateUtils.cleanupTemplate(html)

        } catch (processingError) {
          ctx.logger.error('模板处理失败:', processingError)
          html = `<html><body><h1>渲染错误</h1><p>处理玩家 ${data.name} 的数据时出错: ${processingError.message}</p></body></html>`
        }

        // 7. 渲染HTML为图片
        ctx.logger.debug('开始HTML渲染')
        return await this.html2image(html)
      } catch (error) {
        ctx.logger.error('渲染玩家数据失败:', error)

        // 提供一个简单的错误页面而不是直接失败
        try {
          const errorHtml = `
            <html><body style="font-family:Arial;padding:20px;text-align:center;background:#f5f5f5;">
              <h1 style="color:red">渲染错误</h1>
              <p>无法渲染玩家 ${playerData.player || 'Unknown'} 的数据</p>
              <p>错误信息: ${error?.message || '未知错误'}</p>
              <p>请稍后再试</p>
            </body></html>
          `
          return await this.html2image(errorHtml)
        } catch (fallbackError) {
          // 如果连错误页面都无法渲染，抛出最初的错误
          throw new Error(`渲染失败: ${error?.message || '未知错误'}`)
        }
      }
    }
  }
}

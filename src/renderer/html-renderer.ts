import { Context } from 'koishi'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { HTMLRenderer, PlayerDetailedData, DailyToolsConfig } from '../types'

export function createHTMLRenderer(ctx: Context, config: DailyToolsConfig, playerTemplateFile: string): HTMLRenderer {
  return {
    async html2image(htmlContent: string): Promise<Buffer> {
      try {
        const puppeteer = ctx.get(config.puppeteerService)
        if (!puppeteer) {
          throw new Error(`浏览器渲染服务 "${config.puppeteerService}" 不可用`)
        }

        // 使用正确的 puppeteer API
        const page = await puppeteer.page()
        await page.setContent(htmlContent)

        // 更大的视口，以确保能容纳更多内容
        await page.setViewport({ width: 1000, height: 1200 })

        // 等待所有内容加载完成
        await page.evaluate(() => {
          return new Promise<void>((resolve) => {
            if (document.readyState === 'complete') {
              // 给图表和复杂内容加载留出额外时间
              setTimeout(resolve, 1500)
            } else {
              window.addEventListener('load', () => setTimeout(resolve, 1500))
            }
          })
        })

        const buffer = await page.screenshot({ fullPage: true, type: 'png' })
        await page.close()
        return buffer
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

        ctx.logger.debug('正在处理玩家数据进行渲染', {
          player: playerData.player,
          hasPoints: !!playerData.points,
          hasTeamRank: !!playerData.team_rank
        })

        // 安全提取基本数据，确保所有属性访问都有空值检查
        const safePlayer = {
          // 基本信息
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

          // 额外信息
          country: playerData.country?.name ?? 'Unknown',
          countryCode: playerData.country?.code ?? '',
          totalFinishes: playerData.total_finishes ?? 0,
          firstFinishes: playerData.first_finishes ?? 0,
          mapsPlayed: playerData.maps_played ?? 0,
          joinDate: playerData.joined_date || '-',
          clanTag: playerData.clan_tag || '',

          // 复杂数据
          hasActivity: false,
          hasLastFinishes: Array.isArray(playerData.last_finishes) && playerData.last_finishes.length > 0,
          hasFavoritePartners: Array.isArray(playerData.favorite_partners) && playerData.favorite_partners.length > 0,
          hasFavoriteMaps: Array.isArray(playerData.favorite_maps) && playerData.favorite_maps.length > 0,
          hasBestRanks: Array.isArray(playerData.best_ranks) && playerData.best_ranks.length > 0,

          // 进行安全复制的数组
          lastFinishes: (Array.isArray(playerData.last_finishes) ?
            playerData.last_finishes.slice(0, 10) : []),
          favoritePartners: (Array.isArray(playerData.favorite_partners) ?
            playerData.favorite_partners.slice(0, 5) : []),
          favoriteMaps: (Array.isArray(playerData.favorite_maps) ?
            playerData.favorite_maps.slice(0, 5) : []),
          bestRanks: (Array.isArray(playerData.best_ranks) ?
            playerData.best_ranks.slice(0, 5) : []),

          // 保留可用的扩展数据
          hasCountryRank: !!playerData.country_rank,
          countryRank: playerData.country_rank?.rank ?? 'N/A',
          countryTotalPlayers: playerData.country_rank?.total_players ?? 0,

          // 添加地图类型得分和排名
          typePoints: playerData.type_points || {},
          typeRanks: playerData.type_ranks || {}
        }

        // 判断是否有活动数据
        safePlayer.hasActivity = !!(playerData.activity &&
          ((Array.isArray(playerData.activity.weekly) && playerData.activity.weekly.length > 0) ||
          (Array.isArray(playerData.activity.monthly) && playerData.activity.monthly.length > 0)))

        // 基本数据替换
        let html = template
          .replace(/{{playerName}}/g, safePlayer.name)
          .replace(/{{clanTag}}/g, safePlayer.clanTag)
          .replace(/{{points}}/g, String(safePlayer.points))
          .replace(/{{totalPoints}}/g, String(safePlayer.totalPoints))
          .replace(/{{playerRank}}/g, String(safePlayer.playerRank))
          .replace(/{{rank}}/g, String(safePlayer.playerRank)) // 添加这一行修复{{rank}}问题
          .replace(/{{teamRank}}/g, String(safePlayer.teamRank))
          .replace(/{{favoriteServer}}/g, safePlayer.favoriteServer)
          .replace(/{{serverFinishes}}/g, String(safePlayer.serverFinishes))
          .replace(/{{monthlyPoints}}/g, String(safePlayer.monthlyPoints))
          .replace(/{{monthlyRank}}/g, String(safePlayer.monthlyRank))
          .replace(/{{weeklyPoints}}/g, String(safePlayer.weeklyPoints))
          .replace(/{{weeklyRank}}/g, String(safePlayer.weeklyRank))
          .replace(/{{country}}/g, safePlayer.country)
          .replace(/{{countryCode}}/g, safePlayer.countryCode)
          .replace(/{{countryFlag}}/g, safePlayer.countryCode ?
            `https://ddnet.org/countryflags/${safePlayer.countryCode}.png` : '')
          .replace(/{{totalFinishes}}/g, String(safePlayer.totalFinishes))
          .replace(/{{firstFinishes}}/g, String(safePlayer.firstFinishes))
          .replace(/{{mapsPlayed}}/g, String(safePlayer.mapsPlayed))
          .replace(/{{joinDate}}/g, safePlayer.joinDate)
          .replace(/{{showExtendedStats}}/g, config.showExtendedStats ? 'true' : 'false')

        // 判断是否显示扩展统计信息
        if (!config.showExtendedStats) {
          // 如果不显示扩展统计信息，替换相关标记
          html = html.replace(/{{#if extendedStats}}([\s\S]*?){{\/if extendedStats}}/g, '')
        } else {
          html = html.replace(/{{#if extendedStats}}/g, '').replace(/{{\/if extendedStats}}/g, '')
        }

        // 地图类型得分分布安全提取
        const typePoints = playerData.type_points || {}
        const typeRanks = playerData.type_ranks || {}

        // 处理地图类型得分
        if (Object.keys(safePlayer.typePoints).length > 0) {
          let typePointsHtml = ''

          Object.entries(safePlayer.typePoints).forEach(([type, points]) => {
            const rank = safePlayer.typeRanks[type] || 'N/A'
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

        // 处理活动图表数据
        if (safePlayer.hasActivity) {
          html = html.replace(/{{hasActivity}}/g, 'true')

          // 将活动数据转换为 JavaScript 数组，确保是安全的数组
          const weeklyActivityData = JSON.stringify(
            Array.isArray(playerData.activity?.weekly) ? playerData.activity.weekly : []
          )
          const monthlyActivityData = JSON.stringify(
            Array.isArray(playerData.activity?.monthly) ? playerData.activity.monthly : []
          )

          html = html.replace(/{{weeklyActivityData}}/g, weeklyActivityData)
            .replace(/{{monthlyActivityData}}/g, monthlyActivityData)
        } else {
          html = html.replace(/{{hasActivity}}/g, 'false')
        }

        // 处理最近完成部分
        if (safePlayer.hasLastFinishes) {
          html = html.replace(/{{#if lastFinishes}}([\s\S]*?){{\/if lastFinishes}}/g, '$1')
            .replace(/{{lastFinishesCount}}/g, String(safePlayer.lastFinishes.length))

          let finishesHtml = ''
          for (const finish of safePlayer.lastFinishes) {
            try {
              // 安全格式化时间戳为可读格式
              let dateStr = '-'
              if (finish.timestamp) {
                const date = new Date(finish.timestamp * 1000)
                dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
              }

              finishesHtml += `<tr>
                <td>${finish.map || '-'}</td>
                <td>${typeof finish.time === 'number' ? finish.time.toFixed(2) : '-'}s</td>
                <td>${finish.type || '普通'}</td>
                <td>${finish.country || '-'}</td>
                <td>${dateStr}</td>
                <td>${finish.map_points ? `${finish.map_points}分` : '-'}</td>
              </tr>`
            } catch (err) {
              ctx.logger.error('渲染完成记录时出错:', err)
            }
          }
          html = html.replace(/{{lastFinishesContent}}/g, finishesHtml)
        } else {
          html = html.replace(/{{#if lastFinishes}}[\s\S]*?{{\/if lastFinishes}}/g, '')
        }

        // 处理队友部分
        if (safePlayer.hasFavoritePartners) {
          html = html.replace(/{{#if favoritePartners}}([\s\S]*?){{\/if favoritePartners}}/g, '$1')
            .replace(/{{partnerCount}}/g, String(safePlayer.favoritePartners.length))

          let partnersHtml = ''
          for (const partner of safePlayer.favoritePartners) {
            partnersHtml += `<div class="flex-item">
              <div class="flex-item-name">${partner.name || 'Unknown'}</div>
              <div class="flex-item-stat">${partner.finishes || 0} 次完成</div>
              ${partner.country ? `<div class="flex-item-stat">来自 ${partner.country}</div>` : ''}
            </div>`
          }
          html = html.replace(/{{favoritePartnersContent}}/g, partnersHtml)
        } else {
          html = html.replace(/{{#if favoritePartners}}[\s\S]*?{{\/if favoritePartners}}/g, '')
        }

        // 处理喜爱地图部分
        if (safePlayer.hasFavoriteMaps) {
          html = html.replace(/{{#if favoriteMaps}}([\\s\S]*?){{\/if favoriteMaps}}/g, '$1')
            .replace(/{{favoriteMapCount}}/g, String(safePlayer.favoriteMaps.length))

          let mapsHtml = ''
          for (const map of safePlayer.favoriteMaps) {
            mapsHtml += `<div class="flex-item">
              <div class="flex-item-name">${map.name || 'Unknown'}</div>
              <div class="flex-item-stat">${map.finishes || 0} 次完成</div>
              ${map.points ? `<div class="flex-item-stat">${map.points} 分</div>` : ''}
            </div>`
          }
          html = html.replace(/{{favoriteMapsContent}}/g, mapsHtml)
        } else {
          html = html.replace(/{{#if favoriteMaps}}[\s\S]*?{{\/if favoriteMaps}}/g, '')
        }

        // 处理最佳排名部分
        if (safePlayer.hasBestRanks) {
          html = html.replace(/{{#if bestRanks}}([\s\S]*?){{\/if bestRanks}}/g, '$1')
            .replace(/{{bestRanksCount}}/g, String(safePlayer.bestRanks.length))

          let ranksHtml = ''
          for (const rank of safePlayer.bestRanks) {
            // 安全格式化时间戳
            let dateStr = '-'
            if (rank.timestamp) {
              const date = new Date(rank.timestamp * 1000)
              dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
            }

            ranksHtml += `<div class="rank-item">
              <div class="rank-map">${rank.map || 'Unknown'}</div>
              <div class="rank-position">第${rank.rank || '?'}名</div>
              <div class="rank-time">${typeof rank.time === 'number' ? rank.time.toFixed(2) : '-'}s</div>
              <div class="rank-date">${dateStr}</div>
            </div>`
          }
          html = html.replace(/{{bestRanksContent}}/g, ranksHtml)
        } else {
          html = html.replace(/{{#if bestRanks}}[\s\S]*?{{\/if bestRanks}}/g, '')
        }

        // 处理额外的国家排名数据
        if (safePlayer.hasCountryRank) {
          html = html.replace(/{{hasCountryRank}}/g, 'true')
            .replace(/{{countryRank}}/g, String(safePlayer.countryRank))
            .replace(/{{countryTotalPlayers}}/g, String(safePlayer.countryTotalPlayers))
        } else {
          html = html.replace(/{{hasCountryRank}}/g, 'false')
        }

        // 移除所有对不可用数据的处理
        // 确保模板中相关的变量都被替换为默认值以避免出错
        html = html
          // 地图进度
          .replace(/{{hasMapProgress}}/g, 'false')
          .replace(/{{mapProgressContent}}/g, '<div class="no-data">无地图进度数据</div>')
          // 排名历史
          .replace(/{{hasRankHistory}}/g, 'false')
          // 特殊记录
          .replace(/{{hasRecords}}/g, 'false')
          .replace(/{{firstFinishesContent}}/g, '<div class="no-data">无首次完成记录</div>')
          .replace(/{{fastestFinishesContent}}/g, '<div class="no-data">无最快完成记录</div>')
          // 成就
          .replace(/{{hasAchievements}}/g, 'false')
          // 游戏时间
          .replace(/{{hasPlayingTime}}/g, 'false')
          // 连续记录
          .replace(/{{hasLongestStreak}}/g, 'false')

        // 渲染HTML为图片
        ctx.logger.debug('正在开始HTML渲染...')
        return await this.html2image(html)
      } catch (error) {
        ctx.logger.error('渲染玩家数据失败:', error)
        if (error instanceof Error) {
          // 提供更详细的错误诊断信息
          ctx.logger.error('错误详情:', error.stack)

        }
        throw new Error(`渲染失败: ${error?.message || '未知错误'}`)
      }
    }
  }
}

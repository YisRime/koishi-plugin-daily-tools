import { Context } from 'koishi'
import { createDDNetApi } from '../ddnet-api'

export function registerMapCommands(ctx: Context) {
  const ddnetApi = createDDNetApi(ctx)

  // 获取地图列表
  ctx.command('ddr.maps', '查询 DDRace 地图列表')
    .option('type', '-t <type> 地图类型(如 Novice, Moderate 等)')
    .option('count', '-c <count:number> 显示数量', { fallback: 5 })
    .action(async ({ options }) => {
      try {
        await ctx.broadcast('正在获取地图列表，请稍候...')

        const maps = await ddnetApi.fetchMaps()
        if (!maps) return '获取地图列表失败'

        let filteredMaps = maps
        if (options.type) {
          filteredMaps = maps.filter(map =>
            map.type.toLowerCase() === options.type.toLowerCase())
        }

        const count = Math.min(options.count, 20) // 最多显示20个
        const result = filteredMaps.slice(0, count)

        if (result.length === 0) {
          return '没有找到符合条件的地图'
        }

        let response = '地图列表：\n'
        result.forEach((map, index) => {
          response += `${index + 1}. ${map.name} [${map.type}] - ${map.points}分\n`
        })

        response += `\n共显示 ${result.length}/${filteredMaps.length} 张地图`
        return response
      } catch (error) {
        return `查询失败：${error.message}`
      }
    })

  // 获取服务器状态
  ctx.command('ddr.servers', '查询 DDRace 服务器状态')
    .action(async () => {
      try {
        await ctx.broadcast('正在获取服务器状态，请稍候...')

        const servers = await ddnetApi.fetchServers()
        if (!servers) return '获取服务器状态失败'

        let response = 'DDNet 服务器状态：\n'
        let totalPlayers = 0

        Object.entries(servers).forEach(([location, locationServers]) => {
          if (Array.isArray(locationServers)) {
            let locationPlayerCount = 0
            let serversWithPlayers = 0

            locationServers.forEach(server => {
              if (server.clients > 0) {
                locationPlayerCount += server.clients
                serversWithPlayers++
              }
            })

            if (locationPlayerCount > 0) {
              response += `${location}: ${locationPlayerCount}人 (${serversWithPlayers}个服务器)\n`
              totalPlayers += locationPlayerCount
            }
          }
        })

        response += `\n总在线人数: ${totalPlayers}`
        return response
      } catch (error) {
        return `查询失败：${error.message}`
      }
    })

  // 查询地图排行
  ctx.command('ddr.maprank', '查询地图排行榜')
    .usage('示例: ddr.maprank <地图名称>')
    .action(async (_, mapName) => {
      if (!mapName) return '请提供地图名称'

      try {
        await ctx.broadcast('正在查询地图排行榜，请稍候...')

        const ranks = await ddnetApi.fetchRanks(mapName)
        if (!ranks || ranks.length === 0) return `未找到地图 "${mapName}" 的排行榜`

        let response = `地图 ${mapName} 排行榜：\n`
        ranks.slice(0, 10).forEach((rank, index) => {
          response += `${index + 1}. ${rank.name} - ${rank.time}秒\n`
        })

        return response
      } catch (error) {
        return `查询失败：${error.message}`
      }
    })
}

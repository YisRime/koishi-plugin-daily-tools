import { Context } from 'koishi'
import axios from 'axios'

export interface DDNetApiInterface {
  fetchPlayer(name: string): Promise<any>;
  fetchDetailedPlayer(name: string): Promise<any>;
  fetchMaps(): Promise<any>;
  fetchServers(): Promise<any>;
  fetchRanks(map: string): Promise<any>;
  fetchMapTypes(): Promise<any>;
  fetchMapInfo(mapName: string): Promise<any>;
  fetchPlayerExtended(name: string): Promise<any>;
  fetchPlayerCountryRank(name: string): Promise<any>;
  fetchPlayerRankHistory(name: string): Promise<any>;
}

export function createDDNetApi(ctx: Context): DDNetApiInterface {
  // 基础配置
  const BASE_URL = 'https://ddnet.org'
  const API_TIMEOUT = 10000

  // API工具类
  const apiUtils = {
    // 创建API客户端
    client: axios.create({
      timeout: API_TIMEOUT,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 Koishi-Bot'
      }
    }),

    // 检查响应是否为有效JSON
    isValidJson(data: any): boolean {
      return !(data === null ||
        (typeof data === 'string' && data.trim().startsWith('<')))
    },

    // 安全解析JSON
    safeParseJson(data: any): any {
      if (typeof data !== 'string') return data

      try {
        if (data.trim().startsWith('<!DOCTYPE') || data.trim().startsWith('<html')) {
          ctx.logger.warn('API返回了HTML而不是JSON')
          return null
        }
        return JSON.parse(data)
      } catch (e) {
        ctx.logger.error('JSON解析失败:', e.message.substring(0, 100))
        return null
      }
    },

    // 带重试的API请求
    async fetchWithRetry(url: string, retries = 2) {
      let lastError

      for (let i = 0; i <= retries; i++) {
        try {
          // 添加请求间隔
          if (i > 0) await new Promise(r => setTimeout(r, 1000 * i))

          ctx.logger.debug(`请求(${i+1}/${retries+1}): ${url}`)
          const response = await this.client.get(url)

          // 检查响应类型
          if (!response.headers['content-type']?.includes('json') &&
              !this.isValidJson(response.data)) {
            ctx.logger.warn(`API返回了非JSON数据: ${response.headers['content-type']}`)
          }

          return this.safeParseJson(response.data)
        } catch (error) {
          lastError = error
          ctx.logger.warn(`API请求失败 (${i+1}/${retries+1}): ${error.message}`)
          if (i < retries) continue
        }
      }

      throw lastError
    },

    // 标准化玩家数据
    standardizePlayerData(data: any, name: string) {
      if (!data) return null

      // 对象格式
      if (typeof data === 'object' && (data.player || data.name)) {
        if (!data.points) data.points = { total: 0, points: 0, rank: 'N/A' }
        if (!data.team_rank) data.team_rank = { rank: 'N/A', points: 0 }
        if (!data.rank) data.rank = { rank: 'N/A', points: 0 }
        data.player = data.player || data.name || name
        return data
      }

      // 数组格式 - 取第一个元素
      if (Array.isArray(data) && data.length > 0 && data[0].name) {
        const playerData = data[0]
        if (!playerData.points) playerData.points = { total: 0, points: 0, rank: 'N/A' }
        if (!playerData.team_rank) playerData.team_rank = { rank: 'N/A', points: 0 }
        if (!playerData.rank) playerData.rank = { rank: 'N/A', points: 0 }
        playerData.player = playerData.name || name
        return playerData
      }

      // 未知格式，返回最小数据结构
      ctx.logger.warn(`玩家数据格式异常:`, typeof data)
      return {
        player: name,
        points: { total: 0, points: 0, rank: 'N/A' },
        team_rank: { rank: 'N/A', points: 0 },
        rank: { rank: 'N/A', points: 0 },
        country: { name: 'Unknown', code: '' }
      }
    }
  }

  return {
    // 获取基本玩家数据
    async fetchPlayer(name: string) {
      if (!name || name.trim() === '') {
        ctx.logger.warn('尝试获取空玩家名称')
        return null
      }

      try {
        ctx.logger.debug(`获取玩家数据: ${name}`)
        const encodedName = encodeURIComponent(name.trim())
        const url = `${BASE_URL}/players/?json2=${encodedName}`

        const data = await apiUtils.fetchWithRetry(url)
        return data ? apiUtils.standardizePlayerData(data, name) : null
      } catch (error) {
        ctx.logger.error(`获取玩家数据失败:`, error.message)
        return null
      }
    },

    // 获取详细玩家数据
    async fetchDetailedPlayer(name: string) {
      if (!name || name.trim() === '') {
        ctx.logger.warn('尝试获取空玩家名称')
        return null
      }

      try {
        ctx.logger.debug(`获取详细玩家数据: ${name}`)
        const encodedName = encodeURIComponent(name.trim())

        // 优先获取基本数据
        let data = await this.fetchPlayer(name)

        if (data) {
          try {
            // 尝试获取活动数据
            const activityUrl = `${BASE_URL}/players/activity/${encodeURIComponent(data.player)}.json`
            const activityResponse = await axios.get(activityUrl, {
              timeout: 5000,
              headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 Koishi-Bot' }
            })

            if (apiUtils.isValidJson(activityResponse.data)) {
              data.activity = activityResponse.data
            }
          } catch (e) {
            ctx.logger.debug(`获取活动数据失败: ${e.message}`)
          }

          // 如果没有获取到活动数据，尝试备选API
          if (!data.activity) {
            try {
              const altUrl = `${BASE_URL}/players/${encodedName}?json=1`
              const altData = await apiUtils.fetchWithRetry(altUrl, 1)

              if (altData && typeof altData === 'object') {
                data = { ...data, ...altData }
              }
            } catch (err) {
              ctx.logger.debug(`获取额外数据失败: ${err.message}`)
            }
          }
        } else {
          // 如果基本API失败，尝试备选API
          try {
            const altUrl = `${BASE_URL}/players/${encodedName}?json=1`
            data = await apiUtils.fetchWithRetry(altUrl)

            if (data) {
              data = apiUtils.standardizePlayerData(data, name)
            }
          } catch (err) {
            ctx.logger.error(`所有API请求均失败: ${err.message}`)
            return null
          }
        }

        return data
      } catch (error) {
        ctx.logger.error(`获取详细玩家数据失败:`, error.message)
        return apiUtils.standardizePlayerData(null, name)
      }
    },

    // 获取地图列表
    async fetchMaps() {
      try {
        return await apiUtils.fetchWithRetry(`${BASE_URL}/maps/json/`)
      } catch (error) {
        ctx.logger.error(`获取地图列表失败:`, error.message)
        return null
      }
    },

    // 获取单个地图详细信息
    async fetchMapInfo(mapName: string) {
      try {
        return await apiUtils.fetchWithRetry(`${BASE_URL}/maps/${encodeURIComponent(mapName)}.json`)
      } catch (error) {
        ctx.logger.error(`获取地图信息失败:`, error.message)
        return null
      }
    },

    // 获取服务器状态
    async fetchServers() {
      try {
        return await apiUtils.fetchWithRetry(`${BASE_URL}/status/json/`)
      } catch (error) {
        ctx.logger.error(`获取服务器状态失败:`, error.message)
        return null
      }
    },

    // 获取特定地图的排行榜
    async fetchRanks(map: string) {
      try {
        return await apiUtils.fetchWithRetry(`${BASE_URL}/ranks/${encodeURIComponent(map)}/json/`)
      } catch (error) {
        ctx.logger.error(`获取地图排行榜失败:`, error.message)
        return null
      }
    },

    // 获取地图类型列表
    async fetchMapTypes() {
      try {
        return await apiUtils.fetchWithRetry(`${BASE_URL}/maptypes/json/`)
      } catch (error) {
        ctx.logger.error(`获取地图类型失败:`, error.message)
        return null
      }
    },

    // 获取玩家扩展数据
    async fetchPlayerExtended(name: string) {
      if (!name || name.trim() === '') {
        ctx.logger.warn('尝试获取空玩家名称')
        return null
      }

      try {
        ctx.logger.debug(`获取玩家扩展数据: ${name}`)

        // 获取详细玩家数据作为基础
        const playerData = await this.fetchDetailedPlayer(name)
        if (!playerData) return null

        // 尝试添加国家排名数据
        if (playerData.country?.code) {
          try {
            const countryData = await this.fetchPlayerCountryRank(name)
            if (countryData) playerData.country_rank = countryData
          } catch (e) {
            ctx.logger.debug(`获取国家排名失败: ${e.message}`)
          }
        }

        return playerData
      } catch (error) {
        ctx.logger.error(`获取扩展数据失败:`, error.message)
        return null
      }
    },

    // 获取玩家排名历史
    async fetchPlayerRankHistory(name: string) {
      try {
        const encodedName = encodeURIComponent(name.trim())
        const url = `${BASE_URL}/players/history/${encodedName}.json`
        return await apiUtils.fetchWithRetry(url, 1)
      } catch (error) {
        ctx.logger.debug(`获取排名历史失败: ${error.message}`)
        return null
      }
    },

    // 获取玩家国家排名
    async fetchPlayerCountryRank(name: string) {
      try {
        // 先获取玩家基本信息以确定国家
        const playerData = await this.fetchPlayer(name)
        if (!playerData?.country?.code) return null

        const countryCode = playerData.country.code
        const url = `${BASE_URL}/ranks/country/${countryCode.toLowerCase()}.json`
        const countryRanks = await apiUtils.fetchWithRetry(url, 1)

        if (!countryRanks) return null

        // 查找玩家在排名中的位置
        const playerName = playerData.player || name
        const playerRank = countryRanks.findIndex(
          rank => rank.name.toLowerCase() === playerName.toLowerCase()
        )

        if (playerRank === -1) return null

        return {
          country_code: countryCode,
          country_name: playerData.country.name,
          rank: playerRank + 1,
          total_players: countryRanks.length
        }
      } catch (error) {
        ctx.logger.debug(`获取国家排名失败: ${error.message}`)
        return null
      }
    }
  }
}

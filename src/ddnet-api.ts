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
  fetchPlayerExtended(name: string): Promise<any>;          // 获取额外的玩家数据
  fetchPlayerRankHistory(name: string): Promise<any>;       // 获取玩家排名历史
  fetchPlayerMapProgress(name: string): Promise<any>;       // 获取玩家地图完成进度
  fetchPlayerCountryRank(name: string): Promise<any>;       // 获取玩家国家内排名
  fetchPlayerRecords(name: string): Promise<any>;           // 获取玩家记录
  fetchPlayerAchievements(name: string): Promise<any>;      // 获取玩家成就
}

export function createDDNetApi(ctx: Context): DDNetApiInterface {
  // 基础配置
  const BASE_URL = 'https://ddnet.org'
  const API_TIMEOUT = 10000  // 减少超时时间为10秒

  // 创建具有合理默认值的 axios 实例
  const apiClient = axios.create({
    timeout: API_TIMEOUT,
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 Koishi-Bot'  // 更像浏览器的UA
    }
  })

  // 检查是否是有效的JSON响应
  const isValidJson = (data: any): boolean => {
    if (!data) return false;

    // 如果是字符串并且以 '<' 开头，很可能是HTML
    if (typeof data === 'string' && data.trim().startsWith('<')) {
      return false;
    }

    return true;
  }

  // 安全的JSON解析
  const safeParseJson = (data: any): any => {
    if (typeof data !== 'string') return data;

    try {
      // 检查是否是HTML
      if (data.trim().startsWith('<!DOCTYPE') || data.trim().startsWith('<html')) {
        ctx.logger.warn('API返回了HTML而不是JSON');
        return null;
      }

      return JSON.parse(data);
    } catch (e) {
      ctx.logger.error('JSON解析失败:', e.message.substring(0, 100));
      return null;
    }
  }

  // 添加重试机制
  const fetchWithRetry = async (url: string, retries = 2) => {
    let lastError;
    for (let i = 0; i <= retries; i++) {
      try {
        // 增加延迟防止请求过于频繁
        if (i > 0) await new Promise(r => setTimeout(r, 1000 * i));

        ctx.logger.debug(`尝试请求(${i+1}/${retries+1}): ${url}`);
        const response = await apiClient.get(url);

        // 检查响应类型
        const contentType = response.headers['content-type'] || '';

        // 如果返回的不是JSON，记录日志并可能抛出错误
        if (!contentType.includes('json') && !isValidJson(response.data)) {
          ctx.logger.warn(`API返回了非JSON数据: ${contentType}`);
          // 尝试继续处理，后面的safeParseJson会处理这种情况
        }

        return safeParseJson(response.data);
      } catch (error) {
        lastError = error;
        ctx.logger.warn(`API请求失败 (${i+1}/${retries+1}): ${url} - ${error.message}`);
        // 如果不是最后一次尝试，则等待
        if (i < retries) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      }
    }
    throw lastError;
  }

  return {
    // 获取基本玩家数据 - 使用传统格式，更可靠
    async fetchPlayer(name: string) {
      if (!name || name.trim() === '') {
        ctx.logger.warn('尝试获取空玩家名称');
        return null;
      }

      try {
        ctx.logger.debug(`获取玩家数据: ${name}`);
        // 确保对玩家名称进行编码
        const encodedName = encodeURIComponent(name.trim());
        const url = `${BASE_URL}/players/?json2=${encodedName}`;

        const data = await fetchWithRetry(url);

        if (!data) {
          ctx.logger.warn(`未获取到玩家数据: ${name}`);
          return null;
        }

        // 处理数据格式
        if (typeof data === 'object' && (data.player || data.name)) {
          // 确保API返回的数据至少有基本结构
          if (!data.points) data.points = { total: 0, points: 0, rank: 'N/A' };
          if (!data.team_rank) data.team_rank = { rank: 'N/A', points: 0 };
          if (!data.rank) data.rank = { rank: 'N/A', points: 0 };

          // 确保至少有玩家名称
          data.player = data.player || data.name || name;
          return data;
        } else if (Array.isArray(data) && data.length > 0 && data[0].name) {
          const playerData = data[0];
          // 标准化数据结构
          if (!playerData.points) playerData.points = { total: 0, points: 0, rank: 'N/A' };
          if (!playerData.team_rank) playerData.team_rank = { rank: 'N/A', points: 0 };
          if (!playerData.rank) playerData.rank = { rank: 'N/A', points: 0 };

          playerData.player = playerData.name || name;
          return playerData;
        } else {
          ctx.logger.warn(`玩家数据格式异常:`, typeof data);

          // 创建最小化的数据结构以避免渲染错误
          return {
            player: name,
            points: { total: 0, points: 0, rank: 'N/A' },
            team_rank: { rank: 'N/A', points: 0 },
            rank: { rank: 'N/A', points: 0 },
            country: { name: 'Unknown', code: '' }
          };
        }
      } catch (error) {
        ctx.logger.error(`获取玩家数据失败:`, error.message);
        return null;
      }
    },

    // 获取详细玩家数据 - 现在先尝试稳定的API，再尝试扩展API
    async fetchDetailedPlayer(name: string) {
      if (!name || name.trim() === '') {
        ctx.logger.warn('尝试获取空玩家名称');
        return null;
      }

      try {
        ctx.logger.debug(`获取详细玩家数据: ${name}`);
        const encodedName = encodeURIComponent(name.trim());

        // 首先尝试基本API，这个通常更可靠
        let data = await this.fetchPlayer(name);

        // 如果基本数据获取成功，才尝试获取更多数据
        if (data) {
          try {
            // 获取额外信息-活动数据
            const playerName = data.player || name;
            const activityUrl = `${BASE_URL}/players/activity/${encodeURIComponent(playerName)}.json`;

            // 使用更短的超时时间获取活动数据
            const activityResponse = await axios.get(activityUrl, {
              timeout: 5000,
              headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 Koishi-Bot'
              }
            });

            if (activityResponse.data && isValidJson(activityResponse.data)) {
              data.activity = activityResponse.data;
            }
          } catch (e) {
            // 这是非必需的数据，失败可以忽略
            ctx.logger.debug(`获取玩家活动数据失败: ${e.message}`);
          }

          // 只有在获取基本数据失败且没有活动数据时，才尝试其他API
          if (!data.activity) {
            try {
              // 尝试使用替代API格式获取额外数据
              const altUrl = `${BASE_URL}/players/${encodedName}?json=1`;
              const altData = await fetchWithRetry(altUrl, 1); // 降低重试次数

              if (altData && typeof altData === 'object') {
                // 合并数据
                data = { ...data, ...altData };
              }
            } catch (err) {
              // 失败可以忽略，我们已经有基本数据
              ctx.logger.debug(`获取额外玩家数据失败: ${err.message}`);
            }
          }
        } else {
          // 基本数据获取失败，尝试替代API
          try {
            const altUrl = `${BASE_URL}/players/${encodedName}?json=1`;
            data = await fetchWithRetry(altUrl);

            // 确保基本数据结构
            if (data) {
              if (!data.player && data.name) data.player = data.name;
              if (!data.points) data.points = { total: 0, points: 0, rank: 'N/A' };
              if (!data.team_rank) data.team_rank = { rank: 'N/A', points: 0 };
              if (!data.rank) data.rank = { rank: 'N/A', points: 0 };
            }
          } catch (err) {
            ctx.logger.error(`所有API请求均失败: ${err.message}`);
            return null;
          }
        }

        return data;
      } catch (error) {
        ctx.logger.error(`获取详细玩家数据失败:`, error.message);

        // 创建最小化的数据结构以避免渲染错误
        return {
          player: name,
          points: { total: 0, points: 0, rank: 'N/A' },
          team_rank: { rank: 'N/A', points: 0 },
          rank: { rank: 'N/A', points: 0 },
          country: { name: 'Unknown', code: '' }
        };
      }
    },

    // 获取地图列表
    async fetchMaps() {
      try {
        return await fetchWithRetry(`${BASE_URL}/maps/json/`);
      } catch (error) {
        ctx.logger.error(`获取地图列表失败:`, error.message);
        return null;
      }
    },

    // 获取单个地图详细信息
    async fetchMapInfo(mapName: string) {
      try {
        return await fetchWithRetry(`${BASE_URL}/maps/${encodeURIComponent(mapName)}.json`);
      } catch (error) {
        ctx.logger.error(`获取地图信息失败:`, error.message);
        return null;
      }
    },

    // 获取服务器状态
    async fetchServers() {
      try {
        return await fetchWithRetry(`${BASE_URL}/status/json/`);
      } catch (error) {
        ctx.logger.error(`获取服务器状态失败:`, error.message);
        return null;
      }
    },

    // 获取特定地图的排行榜
    async fetchRanks(map: string) {
      try {
        return await fetchWithRetry(`${BASE_URL}/ranks/${encodeURIComponent(map)}/json/`);
      } catch (error) {
        ctx.logger.error(`获取地图排行榜失败:`, error.message);
        return null;
      }
    },

    // 获取地图类型列表
    async fetchMapTypes() {
      try {
        return await fetchWithRetry(`${BASE_URL}/maptypes/json/`);
      } catch (error) {
        ctx.logger.error(`获取地图类型失败:`, error.message);
        return null;
      }
    },

    // 获取玩家扩展数据 - 综合获取各种数据
    async fetchPlayerExtended(name: string) {
      if (!name || name.trim() === '') {
        ctx.logger.warn('尝试获取空玩家名称');
        return null;
      }

      try {
        ctx.logger.debug(`获取玩家扩展数据: ${name}`);
        const encodedName = encodeURIComponent(name.trim());

        // 尝试获取更全面的玩家数据
        const playerData = await this.fetchDetailedPlayer(name);
        if (!playerData) return null;

        // 尝试获取各种额外数据
        try {
          // 1. 获取国家排名数据
          if (playerData.country && playerData.country.code) {
            const countryData = await this.fetchPlayerCountryRank(name);
            if (countryData) {
              playerData.country_rank = countryData;
            }
          }

          // 2. 获取地图进度数据
          const progressData = await this.fetchPlayerMapProgress(name);
          if (progressData) {
            playerData.map_progress = progressData;
          }

          // 3. 获取记录数据
          const recordsData = await this.fetchPlayerRecords(name);
          if (recordsData) {
            playerData.records = recordsData;
          }

          // 4. 获取成就数据
          const achievementsData = await this.fetchPlayerAchievements(name);
          if (achievementsData) {
            playerData.achievements = achievementsData;
          }
        } catch (e) {
          // 额外数据获取失败不影响基本数据返回
          ctx.logger.debug(`获取玩家扩展数据部分失败: ${e.message}`);
        }

        return playerData;
      } catch (error) {
        ctx.logger.error(`获取玩家扩展数据失败:`, error.message);
        return null;
      }
    },

    // 获取玩家排名历史
    async fetchPlayerRankHistory(name: string) {
      try {
        ctx.logger.debug(`获取玩家排名历史: ${name}`);
        const encodedName = encodeURIComponent(name.trim());
        const url = `${BASE_URL}/players/history/${encodedName}.json`;

        return await fetchWithRetry(url, 1);
      } catch (error) {
        ctx.logger.debug(`获取玩家排名历史失败: ${error.message}`);
        return null;
      }
    },

    // 获取玩家地图完成进度
    async fetchPlayerMapProgress(name: string) {
      try {
        ctx.logger.debug(`获取玩家地图完成进度: ${name}`);
        const encodedName = encodeURIComponent(name.trim());
        const url = `${BASE_URL}/players/progress/${encodedName}.json`;

        return await fetchWithRetry(url, 1);
      } catch (error) {
        ctx.logger.debug(`获取玩家地图完成进度失败: ${error.message}`);
        return null;
      }
    },

    // 获取玩家在国家内的排名
    async fetchPlayerCountryRank(name: string) {
      try {
        // 首先需要获取玩家的基本信息以确定国家
        const playerData = await this.fetchPlayer(name);
        if (!playerData || !playerData.country || !playerData.country.code) {
          return null;
        }

        const countryCode = playerData.country.code;
        const url = `${BASE_URL}/ranks/country/${countryCode.toLowerCase()}.json`;

        const countryRanks = await fetchWithRetry(url, 1);
        if (!countryRanks) return null;

        // 查找玩家在国家排名中的位置
        const playerName = playerData.player || name;
        const playerRank = countryRanks.findIndex(
          rank => rank.name.toLowerCase() === playerName.toLowerCase()
        );

        if (playerRank === -1) return null;

        return {
          country_code: countryCode,
          country_name: playerData.country.name,
          rank: playerRank + 1, // 索引从0开始，排名从1开始
          total_players: countryRanks.length
        };
      } catch (error) {
        ctx.logger.debug(`获取玩家国家排名失败: ${error.message}`);
        return null;
      }
    },

    // 获取玩家记录 - 如首次完成、速度记录等
    async fetchPlayerRecords(name: string) {
      try {
        ctx.logger.debug(`获取玩家记录: ${name}`);
        const encodedName = encodeURIComponent(name.trim());
        const url = `${BASE_URL}/players/records/${encodedName}.json`;

        return await fetchWithRetry(url, 1);
      } catch (error) {
        ctx.logger.debug(`获取玩家记录失败: ${error.message}`);
        return null;
      }
    },

    // 获取玩家成就
    async fetchPlayerAchievements(name: string) {
      try {
        ctx.logger.debug(`获取玩家成就: ${name}`);
        // 注意：这是一个假设的API端点，实际上可能不存在
        const encodedName = encodeURIComponent(name.trim());
        const url = `${BASE_URL}/players/achievements/${encodedName}.json`;

        return await fetchWithRetry(url, 1);
      } catch (error) {
        ctx.logger.debug(`获取玩家成就失败: ${error.message}`);
        return null;
      }
    }
  };
}

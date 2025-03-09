import { Context, h } from 'koishi'
import { DDNetApiInterface } from '../ddnet-api'
import { BindingService, CacheService, HTMLRenderer, PlayerDetailedData } from '../types'

export function registerPlayerCommands(
  ctx: Context,
  ddnetApi: DDNetApiInterface,
  bindingService: BindingService,
  cacheService: CacheService,
  renderer: HTMLRenderer
) {
  // 定义查询选项接口
  interface QueryOptions {
    force?: boolean
    details?: boolean
    full?: boolean
  }

  // 玩家数据获取API
  const api = {
    async fetchPlayer(name: string, options: QueryOptions = {}): Promise<PlayerDetailedData | null> {
      if (!name || name.trim() === '') {
        ctx.logger.warn('尝试获取空玩家名称')
        return null
      }

      // 格式化名称
      name = this.formatPlayerName(name)
      ctx.logger.debug(`开始获取玩家数据: ${name}`)

      try {
        // 使用扩展API获取更丰富的数据
        if (options.details === true) {
          let playerData = await ddnetApi.fetchPlayerExtended(name)
          if (playerData) {
            ctx.logger.info(`成功获取到玩家 ${name} 的扩展数据`)
            return playerData as PlayerDetailedData
          }
        }

        // 如果没请求扩展数据或扩展数据获取失败，回退到详细API
        let playerData = await ddnetApi.fetchDetailedPlayer(name)
        if (playerData) {
          ctx.logger.info(`成功获取到玩家 ${name} 的详细数据`)
          return playerData as PlayerDetailedData
        }

        // 最后尝试基本API
        playerData = await ddnetApi.fetchPlayer(name)
        if (playerData) {
          ctx.logger.info(`成功获取到玩家 ${name} 的基本数据`)
          return playerData as PlayerDetailedData
        }

        ctx.logger.warn(`未找到玩家: ${name}`)
        return null
      } catch (error) {
        ctx.logger.error(`获取玩家数据失败:`, error)
        return null
      }
    },

    // 格式化玩家名称，处理特殊字符和空格
    formatPlayerName(name: string): string {
      if (!name) return ''
      // 去除首尾空格，压缩中间空格
      return name.trim().replace(/\s+/g, ' ')
    }
  }

  // 注册命令
  const ddr = ctx.command('ddr', 'DDRace 游戏相关功能')
    .usage('示例: ddr <玩家名称>')
    .action(async ({ session }, name) => {
      if (!name) return '请提供玩家名称'

      name = api.formatPlayerName(name)

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

        // 绑定玩家名称
        await bindingService.bind(
          userId,
          channelId,
          standardName,
          session.subtype === 'group'
        )

        return `已成功绑定玩家名称：${standardName}`
      } catch (error) {
        ctx.logger.error('玩家绑定验证失败:', error)
        // 出错时仍然允许绑定，但使用原始名称
        await bindingService.bind(
          userId,
          channelId,
          name,
          session.subtype === 'group'
        )

        return `已绑定玩家名称：${name}（警告：无法验证此玩家是否存在）`
      }
    })

  // 处理玩家数据查询的函数
  const handlePlayerQuery = async (session: any, name?: string, options: QueryOptions = {}): Promise<string | h> => {
    const userId = session?.userId
    const channelId = session?.channelId
    const isDetailed = options.details === true

    // 如果没提供名字，尝试使用绑定的名字
    if (!name) {
      if (!userId || !channelId) return '无法获取用户信息，请提供玩家名称'

      const playerName = await bindingService.getName(
        userId,
        channelId,
        session.subtype === 'group'
      )

      if (!playerName) {
        return '你还没有绑定玩家名称，请使用 ddr <玩家名称> 进行绑定'
      }

      name = playerName
    } else {
      name = api.formatPlayerName(name)
      if (!name) return '请提供有效的玩家名称'
    }

    // 使用不同的缓存键以区分普通查询和详细查询
    const cacheKey = isDetailed
      ? `player_detailed_${name}`
      : `player_${name}`

    // 检查缓存
    if (!options.force) {
      const cachedImage = await cacheService.get(cacheKey)
      if (cachedImage) {
        const cacheAge = cacheService.getAge(cacheKey)
        const cacheInfo = `\n数据缓存于${cacheAge || 0}分钟前`

        return h('message', [
          h.text(`${name} 的成绩信息如下：`),
          h.image(cachedImage, 'image/png'),
          h.text(`${cacheInfo}\n使用 ddr.rank -f ${name} 强制刷新`)
        ])
      }
    }

    await session?.send('正在查询玩家数据，请稍候...')

    // 获取新数据
    try {
      ctx.logger.info(`开始查询玩家 ${name} 的数据...`)
      const playerData = await api.fetchPlayer(name, options)

      if (!playerData) {
        ctx.logger.warn(`未找到玩家 ${name} 的数据`)
        return `没找到玩家 "${name}" 的数据，请检查名称是否正确`
      }

      ctx.logger.info(`开始渲染玩家 ${name} 的数据...`)
      const imageData = await renderer.renderPlayerStats(playerData)

      ctx.logger.info(`缓存玩家 ${name} 的数据图像...`)
      await cacheService.set(cacheKey, imageData)

      return h('message', [
        h.text(`${name} 的成绩信息如下：`),
        h.image(imageData, 'image/png'),
        h.text(`\n查询完成 (${new Date().toLocaleTimeString()})`)
      ])
    } catch (error) {
      ctx.logger.error(`查询玩家 ${name} 数据失败:`, error)
      return `查询失败：${error.message || '未知错误'}\n可能是 DDNet 官网暂时无法访问，请稍后再试`
    }
  }

  // 查询玩家分数 - 增强版
  ddr.subcommand('.rank', '查询 DDRace 玩家分数')
    .option('force', '-f 强制刷新缓存')
    .option('details', '-d 显示详细信息')
    .usage('示例: ddr.rank <玩家名称>')
    .action(async ({ session, options }, name) => {
      const queryOptions: QueryOptions = {
        force: options.force === true,
        details: options.details === true
      }
      return await handlePlayerQuery(session, name, queryOptions)
    })

  // 解绑玩家名称
  ddr.subcommand('.unbind', '解除绑定的 DDRace 玩家名称')
    .action(async ({ session }) => {
      const userId = session?.userId
      const channelId = session?.channelId

      if (!userId) return '无法获取用户信息'

      const unbound = await bindingService.unbind(
        userId,
        channelId,
        session.subtype === 'group'
      )

      return unbound ? '解绑成功' : '你尚未绑定任何玩家名称'
    })

  // 添加新的子命令 - 玩家详细统计
  ddr.subcommand('.stats', '查询 DDRace 玩家详细统计')
    .option('force', '-f 强制刷新缓存')
    .usage('示例: ddr.stats <玩家名称>')
    .action(async ({ session, options }, name) => {
      // 使用相同的处理函数，但添加详细选项
      const queryOptions: QueryOptions = {
        force: options.force === true,
        details: true
      }
      return await handlePlayerQuery(session, name, queryOptions)
    })

  // 添加简写命令
  ddr.subcommand('.r', '查询 DDRace 玩家分数 (简写)')
    .option('force', '-f 强制刷新缓存')
    .usage('示例: ddr.r <玩家名称>')
    .action(async ({ session, options }, name) => {
      const queryOptions: QueryOptions = {
        force: options.force === true
      }
      return await handlePlayerQuery(session, name, queryOptions)
    })

  ddr.subcommand('.s', '查询 DDRace 玩家详细统计 (简写)')
    .option('force', '-f 强制刷新缓存')
    .usage('示例: ddr.s <玩家名称>')
    .action(async ({ session, options }, name) => {
      const queryOptions: QueryOptions = {
        force: options.force === true,
        details: true
      }
      return await handlePlayerQuery(session, name, queryOptions)
    })

  // 添加新的子命令 - 查询玩家的完整信息
  ddr.subcommand('.full', '查询 DDRace 玩家的完整统计信息')
    .option('force', '-f 强制刷新缓存')
    .usage('示例: ddr.full <玩家名称>')
    .action(async ({ session, options }, name) => {
      // 使用相同的处理函数，但添加更多数据选项
      const queryOptions: QueryOptions = {
        force: options.force === true,
        details: true,
        full: true  // 添加full选项以获取完整数据
      }
      return await handlePlayerQuery(session, name, queryOptions)
    })

  // 添加查看国家排名的命令
  ddr.subcommand('.country', '查看玩家在国内的排名')
    .usage('示例: ddr.country <玩家名称>')
    .action(async ({ session }, name) => {
      // 如果没提供名字，尝试使用绑定的名字
      if (!name) {
        const userId = session?.userId
        const channelId = session?.channelId

        if (!userId || !channelId) return '无法获取用户信息，请提供玩家名称'

        const playerName = await bindingService.getName(
          userId,
          channelId,
          session.subtype === 'group'
        )

        if (!playerName) {
          return '你还没有绑定玩家名称，请使用 ddr <玩家名称> 进行绑定'
        }

        name = playerName
      } else {
        name = api.formatPlayerName(name)
        if (!name) return '请提供有效的玩家名称'
      }

      try {
        const countryRank = await ddnetApi.fetchPlayerCountryRank(name)
        if (!countryRank) {
          return `未能获取到玩家 ${name} 的国家排名信息`
        }

        return `${name} 在 ${countryRank.country_name}(${countryRank.country_code}) 的排名: 第 ${countryRank.rank} 名 (共 ${countryRank.total_players} 名玩家)`
      } catch (error) {
        return `查询失败: ${error.message}`
      }
    })

  // 添加查看地图完成进度的命令
  ddr.subcommand('.progress', '查看玩家的地图完成进度')
    .usage('示例: ddr.progress <玩家名称>')
    .action(async ({ session }, name) => {
      // 如果没提供名字，尝试使用绑定的名字
      if (!name) {
        const userId = session?.userId
        const channelId = session?.channelId

        if (!userId || !channelId) return '无法获取用户信息，请提供玩家名称'

        const playerName = await bindingService.getName(
          userId,
          channelId,
          session.subtype === 'group'
        )

        if (!playerName) {
          return '你还没有绑定玩家名称，请使用 ddr <玩家名称> 进行绑定'
        }

        name = playerName
      } else {
        name = api.formatPlayerName(name)
        if (!name) return '请提供有效的玩家名称'
      }

      try {
        const progress = await ddnetApi.fetchPlayerMapProgress(name)
        if (!progress) {
          return `未能获取到玩家 ${name} 的地图完成进度信息`
        }

        let response = `${name} 的地图完成进度:\n`

        // 安全处理总进度百分比
        const totalPercentage = typeof progress.completion_percentage === 'number'
          ? progress.completion_percentage.toFixed(2)
          : '0.00';

        response += `总计完成: ${progress.completed_maps || 0}/${progress.total_maps || 0} 张地图 (${totalPercentage}%)\n\n`

        if (progress.maps_by_type) {
          response += '按类型统计:\n'

          // 定义接口以匹配预期的数据结构
          interface MapTypeData {
            total: number;
            completed: number;
            percentage: number;
          }

          // 使用类型断言告诉TypeScript这个对象的结构
          for (const [type, mapData] of Object.entries(progress.maps_by_type)) {
            // 转换为定义的接口类型
            const data = mapData as MapTypeData;

            // 安全处理各类型的百分比
            const percentage = typeof data.percentage === 'number'
              ? data.percentage.toFixed(2)
              : '0.00';

            response += `${type}: ${data.completed || 0}/${data.total || 0} (${percentage}%)\n`
          }
        }

        return response
      } catch (error) {
        return `查询失败: ${error.message}`
      }
    })
}

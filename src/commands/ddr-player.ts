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
  // 玩家数据处理工具
  const playerUtils = {
    // 格式化玩家名称
    formatName(name?: string): string {
      return name?.trim().replace(/\s+/g, ' ') || ''
    },

    // 获取已绑定的玩家名称或使用提供的名称
    async resolvePlayerName(session: any, name?: string): Promise<string> {
      const userId = session?.userId
      const channelId = session?.channelId

      // 如果未提供名称，尝试获取绑定的名称
      if (!name) {
        if (!userId || !channelId) {
          throw new Error('无法获取用户信息，请提供玩家名称')
        }

        const boundName = await bindingService.getName(
          userId,
          channelId,
          session.subtype === 'group'
        )

        if (!boundName) {
          throw new Error('你还没有绑定玩家名称，请使用 ddr <玩家名称> 进行绑定')
        }

        return boundName
      }

      // 使用提供的名称
      const formattedName = this.formatName(name)
      if (!formattedName) {
        throw new Error('请提供有效的玩家名称')
      }

      return formattedName
    },

    // 获取玩家数据
    async fetchPlayer(name: string, options: { details?: boolean, full?: boolean } = {}): Promise<PlayerDetailedData> {
      ctx.logger.debug(`开始获取玩家数据: ${name}`)

      try {
        let playerData: any = null

        // 根据选项决定API调用级别
        if (options.details || options.full) {
          playerData = await ddnetApi.fetchPlayerExtended(name)
          if (playerData) {
            ctx.logger.info(`成功获取到玩家 ${name} 的扩展数据`)
            return playerData
          }
        }

        // 如果扩展API失败，尝试详细API
        if (!playerData) {
          playerData = await ddnetApi.fetchDetailedPlayer(name)
          if (playerData) {
            ctx.logger.info(`成功获取到玩家 ${name} 的详细数据`)
            return playerData
          }
        }

        // 最后尝试基本API
        if (!playerData) {
          playerData = await ddnetApi.fetchPlayer(name)
          if (playerData) {
            ctx.logger.info(`成功获取到玩家 ${name} 的基本数据`)
            return playerData
          }
        }

        // 如果所有API都失败
        throw new Error(`未找到玩家 "${name}" 的数据`)
      } catch (error) {
        ctx.logger.error(`获取玩家数据失败:`, error)
        throw error
      }
    },

    // 从缓存获取或生成新的图像
    async getPlayerImage(session: any, name: string, options: { force?: boolean, details?: boolean, full?: boolean } = {}): Promise<Buffer> {
      // 构建缓存键
      const cacheKey = options.details || options.full
        ? `player_detailed_${name}`
        : `player_${name}`

      // 检查缓存，除非强制刷新
      if (!options.force) {
        const cachedImage = await cacheService.get(cacheKey)
        if (cachedImage) {
          ctx.logger.debug(`使用缓存的玩家数据: ${name}`)
          return cachedImage
        }
      }

      // 获取新数据并渲染
      session?.send('正在查询玩家数据，请稍候...')

      const playerData = await this.fetchPlayer(name, options)
      const imageData = await renderer.renderPlayerStats(playerData)

      // 缓存新图像
      ctx.logger.debug(`缓存玩家 ${name} 的数据...`)
      await cacheService.set(cacheKey, imageData)

      return imageData
    }
  }

  // 定义命令处理函数
  const cmdHandlers = {
    // 处理绑定玩家名称
    async handleBind(session: any, name: string): Promise<string> {
      const userId = session?.userId
      const channelId = session?.channelId

      if (!userId) return '无法获取用户信息'

      try {
        // 验证玩家是否存在
        const playerData = await playerUtils.fetchPlayer(name, {})
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
        ctx.logger.error('绑定失败:', error)

        // 出错时仍然允许绑定，但使用原始名称并显示警告
        await bindingService.bind(
          userId,
          channelId,
          name,
          session.subtype === 'group'
        )

        return `已绑定玩家名称：${name}（警告：无法验证此玩家是否存在）`
      }
    },

    // 处理玩家查询
    async handleQuery(session: any, name?: string, options: { force?: boolean, details?: boolean, full?: boolean } = {}): Promise<h | string> {
      try {
        // 解析玩家名称
        const playerName = await playerUtils.resolvePlayerName(session, name)

        // 获取图像数据
        const imageData = await playerUtils.getPlayerImage(session, playerName, options)
        const cacheAge = cacheService.getAge(`player_${options.details ? 'detailed_' : ''}${playerName}`)
        const cacheInfo = `\n数据缓存于 ${cacheAge || 0} 分钟前`

        // 返回消息
        return h('message', [
          h.text(`${playerName} 的成绩信息如下：`),
          h.image(imageData, 'image/png'),
          h.text(`${cacheInfo}\n使用 ddr.rank -f ${playerName} 强制刷新`)
        ])
      } catch (error) {
        return `查询失败：${error.message || '未知错误'}\n可能是 DDNet 官网暂时无法访问，请稍后再试`
      }
    },

    // 处理国家排名查询
    async handleCountryRank(session: any, name?: string): Promise<string> {
      try {
        // 解析玩家名称
        const playerName = await playerUtils.resolvePlayerName(session, name)

        // 获取国家排名数据
        const countryRank = await ddnetApi.fetchPlayerCountryRank(playerName)
        if (!countryRank) {
          return `未能获取到玩家 ${playerName} 的国家排名信息`
        }

        // 返回排名信息
        return `${playerName} 在 ${countryRank.country_name}(${countryRank.country_code}) 的排名: 第 ${countryRank.rank} 名 (共 ${countryRank.total_players} 名玩家)`
      } catch (error) {
        return `查询失败: ${error.message}`
      }
    },

    // 处理搜索并绑定玩家
    async handleSearch(session: any, term: string): Promise<string> {
      if (!term) return '请提供要搜索的玩家名称'

      const userId = session?.userId
      const channelId = session?.channelId

      if (!userId) return '无法获取用户信息'

      try {
        await session?.send('正在搜索玩家，请稍候...')

        // 通过名称查询玩家
        const playerData = await ddnetApi.fetchPlayer(term)
        if (!playerData) {
          return `未找到与 "${term}" 匹配的玩家，请检查输入是否正确`
        }

        // 绑定找到的玩家
        const playerName = playerData.player
        await bindingService.bind(
          userId,
          channelId,
          playerName,
          session.subtype === 'group'
        )

        // 构建响应信息
        let response = `已成功绑定玩家: ${playerName}`

        if (playerData.points?.rank) {
          response += `\n全球排名: #${playerData.points.rank}`
        }

        if (playerData.country?.name) {
          response += `\n国家: ${playerData.country.name}`
        }

        return response
      } catch (error) {
        ctx.logger.error(`搜索失败:`, error)
        return `搜索失败：${error.message || '未知错误'}`
      }
    }
  }

  // 创建主命令
  const ddr = ctx.command('ddr', 'DDRace 游戏相关功能')
    .usage('示例: ddr <玩家名称> - 绑定玩家名称')
    .action(async ({ session }, name) => {
      if (!name) return '请提供玩家名称'
      name = playerUtils.formatName(name)
      return cmdHandlers.handleBind(session, name)
    })

  // 查询玩家分数
  ddr.subcommand('.rank', '查询 DDRace 玩家分数')
    .alias('.r') // 添加别名
    .option('force', '-f 强制刷新缓存')
    .option('details', '-d 显示详细信息')
    .usage('示例: ddr.rank <玩家名称>')
    .action(async ({ session, options }, name) => {
      return cmdHandlers.handleQuery(session, name, {
        force: options.force === true,
        details: options.details === true
      })
    })

  // 玩家详细统计
  ddr.subcommand('.stats', '查询 DDRace 玩家详细统计')
    .alias('.s') // 添加别名
    .option('force', '-f 强制刷新缓存')
    .usage('示例: ddr.stats <玩家名称>')
    .action(async ({ session, options }, name) => {
      return cmdHandlers.handleQuery(session, name, {
        force: options.force === true,
        details: true
      })
    })

  // 查询完整信息
  ddr.subcommand('.full', '查询 DDRace 玩家完整统计信息')
    .option('force', '-f 强制刷新缓存')
    .usage('示例: ddr.full <玩家名称>')
    .action(async ({ session, options }, name) => {
      return cmdHandlers.handleQuery(session, name, {
        force: options.force === true,
        details: true,
        full: true
      })
    })

  // ID查询 (不区分ID和名称)
  ddr.subcommand('.id', '通过ID或昵称查询 DDRace 玩家')
    .option('force', '-f 强制刷新缓存')
    .option('details', '-d 显示详细信息')
    .usage('示例: ddr.id <玩家ID或昵称>')
    .action(async ({ session, options }, input) => {
      if (!input) return '请提供玩家ID或昵称'
      return cmdHandlers.handleQuery(session, input.trim(), {
        force: options.force === true,
        details: options.details === true
      })
    })

  // 搜索和绑定
  ddr.subcommand('.search', '搜索并绑定DDRace玩家')
    .usage('示例: ddr.search <部分玩家名称或ID>')
    .action(async ({ session }, term) => {
      return cmdHandlers.handleSearch(session, term)
    })

  // 国家排名查询
  ddr.subcommand('.country', '查看玩家在国内的排名')
    .usage('示例: ddr.country <玩家名称>')
    .action(async ({ session }, name) => {
      return cmdHandlers.handleCountryRank(session, name)
    })

  // 解绑玩家名称
  ddr.subcommand('.unbind', '解除绑定的玩家名称')
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
}

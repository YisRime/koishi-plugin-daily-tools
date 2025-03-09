import { Context, Schema } from 'koishi'
import {} from 'koishi-plugin-puppeteer'
import { resolve } from 'path'

import { DailyToolsConfig } from './types'
import { createDDNetApi } from './ddnet-api'
import { registerMapCommands } from './commands/ddr-maps'
import { registerPlayerCommands } from './commands/ddr-player'
import { createCacheService } from './services/cache-service'
import { createBindingService } from './services/binding-service'
import { createHTMLRenderer } from './renderer/html-renderer'
import { initializePlugin } from './utils/init-utils'

export const name = 'daily-tools'

export interface Config extends DailyToolsConfig {}

export const Config: Schema<Config> = Schema.object({
  ddrCacheTime: Schema.number().default(240).description('DDRace 数据缓存时间（分钟），设为 0 表示不使用缓存'),
  ddrReply: Schema.boolean().default(true).description('是否使用回复模式发送DDRace消息'),
  puppeteerService: Schema.string().default('puppeteer').description('使用的浏览器渲染服务名称'),
  showExtendedStats: Schema.boolean().default(true).description('是否显示扩展统计信息（如活动图表、地图类型分析等）'),
  customTemplate: Schema.string().default('').description('自定义模板路径（留空使用默认模板）'),
  debugMode: Schema.boolean().default(false).description('是否启用调试模式（显示更多日志）')
})

// 声明插件依赖
export const inject = ['puppeteer']

export function apply(ctx: Context, config: Config) {

  // 路径定义
  const dataDir = resolve(ctx.baseDir, 'data/daily-tools')
  const cacheDir = resolve(dataDir, 'cache')
  const configDir = resolve(dataDir, 'config')
  const templatesDir = resolve(dataDir, 'templates')
  const bindDataFile = resolve(dataDir, 'ddr-bind.json')
  const playerTemplateFile = config.customTemplate || resolve(templatesDir, 'player-stats.html')

  // 创建各个服务实例
  const ddnetApi = createDDNetApi(ctx)
  const cacheService = createCacheService(ctx, config, cacheDir)
  const bindingService = createBindingService(ctx, bindDataFile)
  const htmlRenderer = createHTMLRenderer(ctx, config, playerTemplateFile)

  // 初始化插件
  initializePlugin(ctx, {
    dataDir,
    cacheDir,
    configDir,
    templatesDir,
    bindDataFile,
    playerTemplateFile
  }).catch(err => ctx.logger.error('插件初始化失败:', err))

  // 注册命令
  registerMapCommands(ctx)
  registerPlayerCommands(ctx, ddnetApi, bindingService, cacheService, htmlRenderer)

  // 定期清理缓存
  ctx.on('ready', () => {
    ctx.logger.info('DDRace查询插件已启动')
  })

  // 插件卸载时的清理工作
  ctx.on('dispose', () => {
    ctx.logger.info('DDRace查询插件已停用')
  })
}

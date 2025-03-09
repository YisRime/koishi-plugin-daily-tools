import { Context } from 'koishi'

// 工具类型定义
export interface BindData {
  group: Record<string, Record<string, string>>
  private: Record<string, string>
}

// DDRace详细玩家数据格式 - 增强版
export interface PlayerDetailedData {
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
  points_last_week?: {
    points: number
    rank: number
  }
  country?: {
    name: string
    code: string
  }
  favorite_server?: {
    server: string
    total_finishes: number
  }
  last_finishes?: Array<{
    timestamp: number
    map: string
    time: number
    country: string
    type: string
    finish_id: number
    server?: string
    map_points?: number
  }>
  favorite_maps?: Array<{
    name: string
    finishes: number
    points?: number
  }>
  favorite_partners?: Array<{
    name: string
    finishes: number
    country?: string
  }>
  activity?: {
    daily: number[]
    weekly: number[]
    monthly: number[]
  }
  total_finishes?: number
  first_finishes?: number
  type_points?: Record<string, number>  // 不同类型地图的得分
  type_ranks?: Record<string, number>   // 不同类型地图的排名
  clan_tag?: string
  joined_date?: string                  // 首次记录日期
  maps_played?: number
  best_ranks?: Array<{
    map: string
    rank: number
    time: number
    timestamp: number
  }>

  // 新增扩展数据
  country_rank?: {            // 国家内排名
    country_code: string,
    country_name: string,
    rank: number,
    total_players: number
  }

  map_progress?: {            // 地图完成进度
    total_maps: number,
    completed_maps: number,
    completion_percentage: number,
    maps_by_type?: Record<string, {
      total: number,
      completed: number,
      percentage: number
    }>
  }

  rank_history?: {            // 排名历史
    dates: string[],
    ranks: number[],
    points: number[]
  }

  records?: {                 // 特殊记录
    first_finishes: Array<{
      map: string,
      time: number,
      date: string,
      type: string
    }>,
    fastest_finishes: Array<{
      map: string,
      time: number,
      date: string,
      server: string
    }>
  }

  achievements?: Array<{      // 游戏成就
    id: string,
    name: string,
    description: string,
    date_earned: string,
    rarity: string            // 稀有度: common, uncommon, rare, epic, legendary
  }>

  playing_time?: {            // 游戏时间统计
    total_seconds: number,
    daily_average: number,
    favorite_time: string     // 最常玩的时间段，如 "晚上"
  }

  longest_streak?: {          // 连续游戏记录
    days: number,
    start_date: string,
    end_date: string
  }
}

// 插件配置接口
export interface DailyToolsConfig {
  ddrCacheTime: number
  ddrReply: boolean
  puppeteerService: string
  showExtendedStats: boolean      // 是否显示扩展统计信息
  customTemplate: string          // 自定义模板路径
}

// 服务接口
export interface CacheService {
  get(key: string): Promise<Buffer | null>
  set(key: string, data: Buffer): Promise<void>
  getAge(key: string): number | null
}

export interface BindingService {
  load(): Promise<BindData>
  save(data: BindData): Promise<void>
  bind(userId: string, channelId: string | undefined, name: string, isGroup: boolean): Promise<void>
  unbind(userId: string, channelId: string | undefined, isGroup: boolean): Promise<boolean>
  getName(userId: string, channelId: string | undefined, isGroup: boolean): Promise<string | null>
}

export interface HTMLRenderer {
  html2image(htmlContent: string): Promise<Buffer>
  renderPlayerStats(playerData: PlayerDetailedData): Promise<Buffer>
}

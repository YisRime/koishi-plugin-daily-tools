import { Context, Schema, h } from 'koishi'
import {} from 'koishi-plugin-puppeteer'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

export const name = 'daily-tools'
export const inject = {optional: ['puppeteer']}

/**
 * 跨平台协议中的用户对象
 */
export interface User {
  id: string
  name: string
  avatar?: string
}

/**
 * 头像叠加配置选项
 */
export interface OverlayOptions {
  /**
   * 头像大小
   */
  size?: number

  /**
   * 头像距顶部距离
   */
  top?: number

  /**
   * 是否显示为圆形
   */
  round?: boolean

  /**
   * 底图文件名
   */
  background?: string
}

export interface Config {
}

export const Config: Schema<Config> = Schema.object({
})

// 定义插件资源路径
const ASSETS_DIR = path.resolve(__dirname, './assets') // 子目录路径
const DEFAULT_AVATAR = path.resolve(ASSETS_DIR, './Ltcat.jpg')
const BACKGROUND_IMAGE = path.resolve(ASSETS_DIR, './PCL-Jiazi.jpg')

/**
 * 将HTML内容渲染为图片
 * @param html HTML内容
 * @param ctx Koishi上下文对象
 * @param options 渲染选项
 * @returns 渲染后的图片Buffer
 * @throws 如果渲染过程出错
 */
export async function htmlToImage(html: string, ctx: Context, options: { width?: number; height?: number } = {}): Promise<Buffer> {
  try {
    const page = await ctx.puppeteer.page()

    // 设置视口大小
    const viewportWidth = options.width || 1920
    const viewportHeight = options.height || 1080

    await page.setViewport({
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor: 2.0
    })

    // 设置简化的HTML内容
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              margin: 0;
              padding: 0;
              overflow: hidden;
            }
          </style>
        </head>
        <body>
          ${html}
        </body>
      </html>
    `, { waitUntil: 'networkidle0' })

    // 等待图片加载完成
    await page.evaluate(() => {
      return Promise.all(
        Array.from(document.querySelectorAll('img'))
          .map(img => {
            if (img.complete) return Promise.resolve();
            return new Promise(resolve => {
              img.addEventListener('load', resolve);
              img.addEventListener('error', resolve);
            });
          })
      );
    });

    // 截取整个页面作为图片
    const imageBuffer = await page.screenshot({
      type: 'png',
      fullPage: false
    })

    await page.close()
    return imageBuffer

  } catch (error) {
    ctx.logger.error('图片渲染出错:', error)
    throw new Error('生成图片时遇到问题，请稍后重试')
  }
}

export function apply(ctx: Context) {
  // 检查 puppeteer 是否可用
  if (!ctx.puppeteer) {
    ctx.logger('daily-tools').warn('未检测到 puppeteer 服务，图像处理功能将不可用。请安装并配置 koishi-plugin-puppeteer')
  }

  // 使用可选链避免直接访问 browser 属性
  const logger = ctx.logger('daily-tools')

  if (!existsSync(DEFAULT_AVATAR)) {
    logger.warn(`默认头像文件不存在: ${DEFAULT_AVATAR}`)
  }

  if (!existsSync(BACKGROUND_IMAGE)) {
    logger.warn(`背景图片文件不存在: ${BACKGROUND_IMAGE}`)
  }

  /**
   * 解析目标用户ID (支持@元素、@数字格式或纯数字)
   * @param target - 要解析的目标字符串，可以是纯数字、`@`元素或`@`数字格式
   * @returns 解析出的用户ID，如果解析失败则返回null
   */
  function parseTarget(target: string): string | null {
    if (!target) return null
    // 尝试解析at元素
    try {
      const atElement = h.select(h.parse(target), 'at')[0]
      if (atElement?.attrs?.id) return atElement.attrs.id;
    } catch {}
    // 尝试匹配@数字格式或纯数字
    const atMatch = target.match(/@(\d+)/)
    const userId = atMatch ? atMatch[1] : (/^\d+$/.test(target.trim()) ? target.trim() : null);
    // 验证ID格式：5-10位数字
    return userId && /^\d{5,10}$/.test(userId) ? userId : null;
  }

  ctx.command('make [target:text]', '为头像添加背景效果')
    .action(async ({ session }, target) => {
      // 检查 puppeteer 是否可用
      if (!ctx.puppeteer) {
        return '该功能需要 puppeteer 支持。请确保已安装并配置 koishi-plugin-puppeteer 插件。'
      }

      // 解析用户ID
      let userId = session.userId

      // 如果提供了目标，尝试解析
      if (target) {
        const parsedId = parseTarget(target)
        if (parsedId) {
          userId = parsedId
        }
      }

      if (!userId) return '请指定一个有效的用户'

      try {
        const avatar = await getUserAvatar(session, userId)
        const result = await overlayAvatar(avatar, ctx)
        return h.image(result, 'image/png')
      } catch (error) {
        logger.error(error)
        return '处理头像时出错：' + error.message
      }
    })
}

/**
 * 获取用户头像
 * 从会话中获取用户信息
 * 如果无法获取则返回默认头像
 */
async function getUserAvatar(session, userId: string): Promise<string> {
  if (userId === session.userId && session.user?.avatar) {
    return session.user.avatar;
  }

  if (session.bot) {
    try {
      const user = await session.bot.getUser(userId);
      if (user?.avatar) return user.avatar;
    } catch (e) { /* 忽略错误继续 */ }
  }

  // 直接返回默认头像文件路径
  return `file://${DEFAULT_AVATAR}`;
}

// 使用底图和用户头像生成合成图
async function overlayAvatar(avatarUrl: string, ctx: Context): Promise<Buffer> {
  // 确保 puppeteer 可用
  if (!ctx.puppeteer) {
    throw new Error('无法访问 Puppeteer 服务，请检查 puppeteer 插件配置')
  }

  try {
    // 准备头像URL
    let avatarImageSrc = avatarUrl;
    if (avatarUrl.startsWith('file://')) {
      try {
        // 如果是本地文件路径，尝试将默认头像转换为base64
        const filePath = avatarUrl.replace('file://', '');
        const imageBuffer = readFileSync(filePath);
        avatarImageSrc = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
      } catch (e) {
        ctx.logger('daily-tools').error('无法读取默认头像:', e);
        // 使用备用头像方案 (可以是一个简单的彩色方块)
        avatarImageSrc = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      }
    }

    // 读取背景图片
    const backgroundImage = `data:image/jpeg;base64,${readFileSync(BACKGROUND_IMAGE).toString('base64')}`

    // 创建自定义的HTML内容用于头像叠加
    const html = `
    <div style="width: 1920px; height: 1080px; position: relative; margin: 0; padding: 0; overflow: hidden; background: none;">
      <img style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover;" src="${backgroundImage}" />
      <img style="position: absolute; top: 100px; left: 50%; transform: translateX(-50%); width: 600px; height: 600px; object-fit: cover; z-index: 2; border-radius: 10px; box-shadow: 0 5px 15px rgba(0,0,0,0.3);" src="${avatarImageSrc}" />
    </div>
    `

    // 使用通用的HTML渲染函数生成图片
    return await htmlToImage(html, ctx, {width: 1920, height: 1080})

  } catch (error) {
    ctx.logger('daily-tools').error('头像合成出错:', error)
    throw new Error('合成头像时遇到问题，请稍后重试')
  }
}

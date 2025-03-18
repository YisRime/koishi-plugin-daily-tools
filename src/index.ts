import { Context, Schema, h } from 'koishi'
import {} from 'koishi-plugin-puppeteer'
import { resolve } from 'path'
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

export function apply(ctx: Context) {
  const browser = ctx.puppeteer?.browser

  if (!browser) {
    ctx.logger('daily-tools').warn('未找到 puppeteer 插件，头像叠加功能将不可用')
    return
  }

  if (!existsSync(DEFAULT_AVATAR)) {
    ctx.logger('daily-tools').warn(`默认头像文件不存在: ${DEFAULT_AVATAR}`)
  }

  if (!existsSync(BACKGROUND_IMAGE)) {
    ctx.logger('daily-tools').warn(`背景图片文件不存在: ${BACKGROUND_IMAGE}`)
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
        const result = await overlayAvatar(browser, avatar, ctx)
        return h.image(result, 'image/png')
      } catch (error) {
        ctx.logger('daily-tools').error(error)
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
async function overlayAvatar(browser: any, avatarUrl: string, ctx: Context): Promise<Buffer> {
  const page = await browser.newPage()

  try {
    // 调整视口大小与背景图匹配
    await page.setViewport({ width: 1920, height: 1080 })

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

    const html = `
    <style>
      body { margin: 0; padding: 0; width: 1920px; height: 1080px; position: relative; overflow: hidden; }
      .background { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; }
      .avatar {
        position: absolute;
        top: 100px;
        left: 50%;
        transform: translateX(-50%);
        width: 600px;
        height: 600px;
        object-fit: cover;
        z-index: 2;
      }
    </style>
    <img class="background" src="${backgroundImage}" />
    <img class="avatar" src="${avatarImageSrc}" />`

    await page.setContent(html)

    // 简化图片加载等待逻辑
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

    return await page.screenshot({ type: 'png' });
  } finally {
    await page.close();
  }
}

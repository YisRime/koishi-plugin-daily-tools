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

// 图片处理相关常量
const IMAGE_CONFIG = {
  // 默认图片尺寸配置
  sizes: {
    standard: { width: 1280, height: 720 }, // 标准16:9
    square: { width: 800, height: 800 }, // 正方形
    small: { width: 640, height: 360 } // 小尺寸16:9
  },
  // 不同风格的背景图及配置
  styles: {
    jiazi: {
      background: path.resolve(ASSETS_DIR, './PCL-Jiazi.jpg'),
      avatarSize: 400,
      avatarTop: 60,
      borderRadius: 8
    },
    // 调整tntboom风格
    tntboom: {
      background: path.resolve(ASSETS_DIR, './HMCL-Boom.jpg'),
      avatarSize: 320,
      avatarTop: 20,
      avatarOffsetX: 50,
      borderRadius: 8
    }
  }
};

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
    const viewportWidth = options.width
    const viewportHeight = options.height

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

/**
 * 将图片资源转为base64数据URL
 * @param imagePath 图片路径或URL
 * @returns base64格式的数据URL
 */
function imageToDataUrl(imagePath: string): string {
  try {
    if (imagePath.startsWith('file://')) {
      const filePath = imagePath.replace('file://', '');
      if (existsSync(filePath)) {
        const imageBuffer = readFileSync(filePath);
        return `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
      }
    }
    // 如果是远程URL，直接返回
    return imagePath;
  } catch (e) {
    // 返回一个1x1像素的透明图片作为备用
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  }
}

/**
 * 生成头像效果合成图
 * @param avatarUrl 头像URL或路径
 * @param style 样式名称
 * @param ctx Koishi上下文
 * @param isRound 是否使用圆形头像
 * @returns 合成后的图片Buffer
 */
async function generateAvatarEffect(avatarUrl: string, style: string, ctx: Context, isRound: boolean = false): Promise<Buffer> {
  // 获取样式配置
  const styleConfig = IMAGE_CONFIG.styles[style] || IMAGE_CONFIG.styles.jiazi;
  const sizeConfig = IMAGE_CONFIG.sizes.standard;

  // 准备图片资源
  const avatarImageSrc = imageToDataUrl(avatarUrl);
  const backgroundImage = imageToDataUrl(`file://${styleConfig.background}`);

  // 处理水平位置，如果有偏移则应用偏移值，否则居中
  const horizontalPosition = styleConfig.avatarOffsetX
    ? `left: calc(50% + ${styleConfig.avatarOffsetX}px); transform: translateX(-50%);`
    : `left: 50%; transform: translateX(-50%);`;

  // 确定头像边框半径 - 圆形或默认圆角
  const borderRadius = isRound ? '50%' : `${styleConfig.borderRadius}px`;

  // 创建HTML布局
  const html = `
    <div style="width: ${sizeConfig.width}px; height: ${sizeConfig.height}px; position: relative; margin: 0; padding: 0; overflow: hidden; background: none;">
      <img style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover;" src="${backgroundImage}" />
      <img style="position: absolute; top: ${styleConfig.avatarTop}px; ${horizontalPosition} width: ${styleConfig.avatarSize}px; height: ${styleConfig.avatarSize}px; object-fit: cover; z-index: 2; border-radius: ${borderRadius}; box-shadow: 0 5px 15px rgba(0,0,0,0.3);" src="${avatarImageSrc}" />
    </div>
  `;

  // 渲染图片
  return await htmlToImage(html, ctx, sizeConfig);
}

export function apply(ctx: Context) {
  // 检查资源文件
  const logger = ctx.logger('daily-tools');
  Object.values(IMAGE_CONFIG.styles).forEach(style => {
    if (!existsSync(style.background)) {
      logger.warn(`样式背景图片不存在: ${style.background}`);
    }
  });

  if (!existsSync(DEFAULT_AVATAR)) {
    logger.warn(`默认头像文件不存在: ${DEFAULT_AVATAR}`);
  }

  /**
   * 解析目标用户ID (支持@元素、@数字格式或纯数字)
   */
  function parseTarget(target: string): string | null {
    if (!target) return null;
    try {
      const atElement = h.select(h.parse(target), 'at')[0];
      if (atElement?.attrs?.id) return atElement.attrs.id;
    } catch {}

    const atMatch = target.match(/@(\d+)/);
    const userId = atMatch ? atMatch[1] : (/^\d+$/.test(target.trim()) ? target.trim() : null);
    return userId && /^\d{5,10}$/.test(userId) ? userId : null;
  }

  // 创建主命令
  const make = ctx.command('make', '制作图片表情包');

  // 通用的头像处理函数
  async function handleAvatarCommand(session, target, style, options: { round?: boolean } = {}) {
    // 解析用户ID
    let userId = session.userId;
    if (target) {
      const parsedId = parseTarget(target);
      if (parsedId) userId = parsedId;
    }

    if (!userId) return '请指定一个有效的用户';

    try {
      const avatar = await getUserAvatar(session, userId);
      // 只使用选项中的round值
      const isRound = !!options.round;
      const result = await generateAvatarEffect(avatar, style, ctx, isRound);
      return h.image(result, 'image/png');
    } catch (error) {
      logger.error(error);
      return '处理头像时出错：' + error.message;
    }
  }

  // 创建子命令 jiazi
  make.subcommand('.jiazi [target:text]', '生成"你要被夹"表情包')
    .option('round', '-r 使用圆形头像')
    .action(async ({ session, options }, target) => {
      return handleAvatarCommand(session, target, 'jiazi', options);
    });

  // 创建子命令 tntboom
  make.subcommand('.tntboom [target:text]', '生成"你要被炸"表情包')
    .option('round', '-r 使用圆形头像')
    .action(async ({ session, options }, target) => {
      return handleAvatarCommand(session, target, 'tntboom', options);
    });
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

  return `file://${DEFAULT_AVATAR}`;
}

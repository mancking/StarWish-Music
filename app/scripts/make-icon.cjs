/**
 * 生成「星河」品牌图标与封面（纯代码绘制，不依赖外部素材）。
 * 运行：npx electron scripts/make-icon.cjs
 */
const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')

const SIZE = 1024
const outDir = path.join(__dirname, '..', 'resources')
fs.mkdirSync(outDir, { recursive: true })

function rng(seed) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

/** 沿三次贝塞尔曲线采样，返回点与法线 */
function bezier(p0, p1, p2, p3, t) {
  const mt = 1 - t
  const x = mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x
  const y = mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y
  const dx = 3 * mt ** 2 * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t ** 2 * (p3.x - p2.x)
  const dy = 3 * mt ** 2 * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t ** 2 * (p3.y - p2.y)
  const len = Math.hypot(dx, dy) || 1
  return { x, y, nx: -dy / len, ny: dx / len }
}

function starField() {
  const rand = rng(20261017)
  const p0 = { x: 70, y: 930 }
  const p1 = { x: 300, y: 690 }
  const p2 = { x: 700, y: 520 }
  const p3 = { x: 960, y: 90 }

  let dots = ''
  // 河带上的密集星点
  for (let i = 0; i < 420; i++) {
    const t = Math.pow(rand(), 0.72)
    const p = bezier(p0, p1, p2, p3, t)
    const spread = 62 + 120 * Math.sin(Math.PI * t)
    const off = (rand() + rand() + rand() - 1.5) * spread
    const x = p.x + p.nx * off
    const y = p.y + p.ny * off
    if (x < 20 || x > SIZE - 20 || y < 20 || y > SIZE - 20) continue
    const r = 1.2 + Math.pow(rand(), 2.6) * 6.4
    const a = 0.16 + Math.pow(rand(), 1.4) * 0.8
    const warm = rand()
    const fill = warm > 0.82 ? '#ffd9e8' : warm > 0.6 ? '#c9d8ff' : '#ffffff'
    dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${fill}" opacity="${a.toFixed(2)}"/>`
    if (r > 4.4) {
      dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 3.4).toFixed(1)}" fill="${fill}" opacity="${(a * 0.12).toFixed(2)}"/>`
    }
  }
  // 背景散星
  for (let i = 0; i < 130; i++) {
    const x = rand() * SIZE
    const y = rand() * SIZE * 0.86
    const r = 0.8 + rand() * 2.2
    dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#ffffff" opacity="${(0.08 + rand() * 0.35).toFixed(2)}"/>`
  }
  return dots
}

function noteShape(cx, cy, scale, fill) {
  const s = scale
  return `<g transform="translate(${cx} ${cy}) scale(${s})" fill="${fill}">
    <rect x="-9" y="-150" width="18" height="150" rx="9"/>
    <path d="M9 -150 C 74 -140 96 -108 92 -56 C 82 -92 56 -104 9 -104 Z"/>
    <ellipse cx="-46" cy="-6" rx="52" ry="38" transform="rotate(-18 -46 -6)"/>
  </g>`
}

function svg({ withText }) {
  const stars = starField()
  const textBlock = withText
    ? `<g>
        <text x="512" y="796" text-anchor="middle" font-family="'Microsoft YaHei','PingFang SC','Noto Sans SC',sans-serif"
          font-size="150" font-weight="700" letter-spacing="26"
          fill="url(#textGrad)" opacity="0.98">星河</text>
        <text x="512" y="868" text-anchor="middle" font-family="'Segoe UI',sans-serif"
          font-size="40" letter-spacing="14" fill="#c7c9e8" opacity="0.62">STARWISH MUSIC</text>
      </g>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#070a16"/>
      <stop offset="0.45" stop-color="#111033"/>
      <stop offset="1" stop-color="#241243"/>
    </linearGradient>
    <radialGradient id="nebula" cx="0.72" cy="0.18" r="0.75">
      <stop offset="0" stop-color="#7c3aed" stop-opacity="0.55"/>
      <stop offset="0.5" stop-color="#4c1d95" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="nebula2" cx="0.18" cy="0.86" r="0.6">
      <stop offset="0" stop-color="#ff4d6d" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="river" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#ff4d6d" stop-opacity="0.10"/>
      <stop offset="0.45" stop-color="#c084fc" stop-opacity="0.26"/>
      <stop offset="1" stop-color="#8ab4ff" stop-opacity="0.08"/>
    </linearGradient>
    <linearGradient id="textGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.55" stop-color="#ffe3ef"/>
      <stop offset="1" stop-color="#c4b5fd"/>
    </linearGradient>
    <linearGradient id="noteGrad" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#d8c7ff"/>
    </linearGradient>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="26"/>
    </filter>
    <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="14" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="round">
      <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="216" ry="216"/>
    </clipPath>
  </defs>

  <g clip-path="url(#round)">
    <rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>
    <rect width="${SIZE}" height="${SIZE}" fill="url(#nebula)"/>
    <rect width="${SIZE}" height="${SIZE}" fill="url(#nebula2)"/>

    <!-- 银河光带 -->
    <path d="M70 930 C 300 690, 700 520, 960 90" stroke="url(#river)" stroke-width="230" fill="none" filter="url(#soft)" stroke-linecap="round"/>
    <path d="M70 930 C 300 690, 700 520, 960 90" stroke="#ffffff" stroke-opacity="0.05" stroke-width="70" fill="none" filter="url(#soft)" stroke-linecap="round"/>

    ${stars}

    <!-- 月牙 -->
    <g filter="url(#glow)" opacity="0.95">
      <path d="M760 196 a78 78 0 1 0 0 156 a62 62 0 1 1 0 -156 z" fill="#fff6dd" opacity="0.92"/>
    </g>
    <circle cx="760" cy="274" r="118" fill="#fff2cf" opacity="0.05"/>

    <!-- 音符 -->
    <g filter="url(#glow)" opacity="0.98">
      ${withText ? noteShape(512, 548, 0.98, 'url(#noteGrad)') : noteShape(430, 640, 1.18, 'url(#noteGrad)')}
    </g>
    <circle cx="${withText ? 470 : 356}" cy="${withText ? 600 : 636}" r="118" fill="#ff4d6d" opacity="0.10" filter="url(#soft)"/>

    ${textBlock}

    <!-- 内描边 -->
    <rect x="2" y="2" width="${SIZE - 4}" height="${SIZE - 4}" rx="214" fill="none" stroke="#ffffff" stroke-opacity="0.10" stroke-width="4"/>
  </g>
</svg>`
}

let sharedWin = null

async function render(svgString, file, size) {
  if (!sharedWin || sharedWin.isDestroyed()) {
    sharedWin = new BrowserWindow({
      width: SIZE,
      height: SIZE,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: { backgroundThrottling: false },
    })
  }
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    svg{display:block;width:${SIZE}px;height:${SIZE}px}
  </style></head><body>${svgString}</body></html>`
  const tmp = path.join(outDir, `.tmp-icon-${size}-${Date.now()}.html`)
  fs.writeFileSync(tmp, html, 'utf8')
  await sharedWin.loadFile(tmp)
  await new Promise(r => setTimeout(r, 700))
  let img = await sharedWin.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })
  if (size !== SIZE) img = img.resize({ width: size, height: size, quality: 'best' })
  fs.writeFileSync(file, img.toPNG())
  try { fs.unlinkSync(tmp) } catch {}
  console.log('[icon] 已生成', file)
}

/** 用多尺寸 PNG 组装标准 ICO（Windows 图标） */
function writeIco(sourcePng, file) {
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const base = nativeImage.createFromPath(sourcePng)
  const pngs = sizes.map(s => base.resize({ width: s, height: s, quality: 'best' }).toPNG())
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)
  const entries = []
  let offset = 6 + count * 16
  for (let i = 0; i < count; i++) {
    const png = pngs[i]
    const e = Buffer.alloc(16)
    const s = sizes[i]
    e.writeUInt8(s >= 256 ? 0 : s, 0)
    e.writeUInt8(s >= 256 ? 0 : s, 1)
    e.writeUInt8(0, 2)
    e.writeUInt8(0, 3)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    offset += png.length
  }
  fs.writeFileSync(file, Buffer.concat([header, ...entries, ...pngs]))
  console.log('[icon] 已生成', file)
}

app.whenReady().then(async () => {
  try {
    await render(svg({ withText: false }), path.join(outDir, 'icon.png'), SIZE)
    await render(svg({ withText: true }), path.join(outDir, 'cover.png'), SIZE)
    await render(svg({ withText: false }), path.join(outDir, 'tray.png'), 32)
    writeIco(path.join(outDir, 'icon.png'), path.join(outDir, 'icon.ico'))
    console.log('[icon] 完成')
  } catch (e) {
    console.error('[icon] 生成失败', e)
    process.exitCode = 1
  } finally {
    try { if (sharedWin && !sharedWin.isDestroyed()) sharedWin.destroy() } catch {}
    try { for (const f of fs.readdirSync(outDir)) if (f.startsWith('.tmp-icon')) fs.unlinkSync(path.join(outDir, f)) } catch {}
    app.quit()
  }
})

import fs from 'node:fs'
import path from 'node:path'
import { userDataDir } from './paths'

/**
 * GPU 崩溃看门狗（三级降级）。
 *
 * 现象：窗口构造完成后进程在首帧合成阶段崩溃（Chromium GPU/viz 初始化 CHECK 失败，
 * 退出码 0x80000003 STATUS_BREAKPOINT），日志里已写入「启动完成」却没有任何窗口，
 * 用户看到的就是「双击无反应、任务管理器里只有后台进程」。
 *
 * 旧实现只降一级（关硬件加速），降级后仍失败就永久卡死。现在改为按连续失败次数升级：
 *   1 次 → 关硬件加速
 *   2 次 → 再关 GPU 合成与 WebGL
 *   3 次 → 直接 --disable-gpu（纯软件渲染，能跑就行）
 * 一旦窗口真正显示成功，计数清零、级别归零，下次回到正常硬件加速。
 *
 * 标记文件 `.window-init` 在窗口显示后由 windows.ts 延后清除；正常退出（before-quit）
 * 也会清除，避免用户手动结束进程导致下次误判。
 */

const MARK = '.window-init'
const STATE = '.gpu-state.json'

export type GpuLevel = 0 | 1 | 2 | 3

export interface GpuState {
  failCount: number
  level: GpuLevel
  updatedAt: number
}

function markPath(): string {
  return path.join(userDataDir(), MARK)
}

function statePath(): string {
  return path.join(userDataDir(), STATE)
}

export function readGpuState(): GpuState {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'))
    const n = Number(raw?.level)
    const level = (Number.isFinite(n) ? Math.min(3, Math.max(0, Math.trunc(n))) : 0) as GpuLevel
    return {
      failCount: Math.max(0, Number(raw?.failCount) || 0),
      level,
      updatedAt: Number(raw?.updatedAt) || 0,
    }
  } catch {
    return { failCount: 0, level: 0, updatedAt: 0 }
  }
}

function writeGpuState(s: GpuState): void {
  try {
    fs.writeFileSync(statePath(), JSON.stringify(s), 'utf8')
  } catch {
    /* 状态写不进去不影响启动，只是下次无法累计 */
  }
}

/** 用户手动恢复：设置页「恢复默认图形设置」调用 */
export function resetGpuState(): void {
  writeGpuState({ failCount: 0, level: 0, updatedAt: Date.now() })
  try {
    fs.unlinkSync(markPath())
  } catch {
    /* ignore */
  }
}

/**
 * 启动早期调用（必须在 app ready 之前，才能应用 disableHardwareAcceleration）。
 * 返回本次应采用的降级级别。
 */
export function beginWindowInitWatch(): { crashedLastRun: boolean; level: GpuLevel } {
  const crashedLastRun = fs.existsSync(markPath())
  const st = readGpuState()

  if (crashedLastRun) {
    st.failCount += 1
    st.level = Math.min(3, st.failCount) as GpuLevel
  } else {
    // 上次是正常退出的，计数清零，避免偶发崩溃被永久累计
    st.failCount = 0
    st.level = 0
  }

  st.updatedAt = Date.now()
  writeGpuState(st)

  try {
    fs.writeFileSync(markPath(), String(Date.now()))
  } catch {
    /* 标记写不进去也不影响启动 */
  }

  return { crashedLastRun, level: st.level }
}

/** 窗口首次真正显示后调用，表示已越过危险区。 */
export function endWindowInitWatch(): void {
  try {
    fs.unlinkSync(markPath())
  } catch {
    /* ignore */
  }
  writeGpuState({ failCount: 0, level: 0, updatedAt: Date.now() })
}

/** 正常退出时清除标记，防止「任务管理器结束进程」被误判为窗口初始化崩溃。 */
export function clearWindowInitMark(): void {
  try {
    fs.unlinkSync(markPath())
  } catch {
    /* ignore */
  }
}

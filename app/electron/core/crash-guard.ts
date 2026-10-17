import fs from 'node:fs'
import path from 'node:path'
import { userDataDir } from './paths'

/**
 * GPU 崩溃看门狗。
 *
 * 现象：窗口构造完成后进程在首帧合成阶段崩溃（Chromium GPU/viz 初始化 CHECK 失败，
 * 退出码 0x80000003 STATUS_BREAKPOINT），日志里已写入「启动完成」却没有任何窗口，
 * 用户看到的就是「双击无反应、任务管理器里只有后台进程」。
 *
 * 对策：启动时留一个标记文件，窗口真正显示后删除。若下次启动发现标记仍在，
 * 说明上次死在窗口初始化阶段，本次自动关闭硬件加速重试，避免永久崩溃循环。
 */
const MARK = '.window-init'

function markPath(): string {
  return path.join(userDataDir(), MARK)
}

/** 启动早期调用：返回上次是否死在窗口初始化阶段。 */
export function beginWindowInitWatch(): boolean {
  const p = markPath()
  const crashedLastRun = fs.existsSync(p)
  try {
    fs.writeFileSync(p, String(Date.now()))
  } catch {
    /* 标记写不进去也不影响启动 */
  }
  return crashedLastRun
}

/** 窗口首次真正显示后调用，表示已越过危险区。 */
export function endWindowInitWatch(): void {
  try {
    fs.unlinkSync(markPath())
  } catch {
    /* ignore */
  }
}

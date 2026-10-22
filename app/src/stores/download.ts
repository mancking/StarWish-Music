import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { call, on } from '@/api'
import type { Song } from '@shared/types'

export type DownloadStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled'

export interface DownloadTask {
  id: string
  song: Song
  status: DownloadStatus
  quality: string
  progress: number
  received: number
  total: number
  file?: string
  error?: string
  createdAt: number
  finishedAt?: number
}

/**
 * 下载队列（前端镜像）。
 *
 * 真正的队列在主进程，这里只保存一份用于渲染的副本，靠 `download:progress`
 * 事件增量更新——不要在这里做重排/去重，否则会和服务端状态打架。
 */
export const useDownloadStore = defineStore('download', () => {
  const tasks = ref<DownloadTask[]>([])
  const dir = ref('')
  const panelOpen = ref(false)
  let inited = false

  const active = computed(() => tasks.value.filter(t => t.status === 'running' || t.status === 'queued'))
  const finished = computed(() =>
    tasks.value.filter(t => t.status === 'done' || t.status === 'error' || t.status === 'canceled')
  )
  const runningCount = computed(() => active.value.length)

  async function init(): Promise<void> {
    if (inited) return
    inited = true
    try {
      const list = await call<DownloadTask[]>('download:list')
      tasks.value = Array.isArray(list) ? list : []
    } catch {
      tasks.value = []
    }
    try {
      dir.value = await call<string>('download:dir')
    } catch {
      dir.value = ''
    }
    on('download:progress', (t: DownloadTask) => {
      if (!t?.id) return
      const i = tasks.value.findIndex(x => x.id === t.id)
      if (i >= 0) tasks.value[i] = t
      else tasks.value.unshift(t)
    })
  }

  async function add(songs: Song[], quality?: string): Promise<number> {
    if (!songs.length) return 0
    const created = await call<DownloadTask[]>('download:add', { songs, quality })
    return created?.length || 0
  }

  async function cancel(id: string): Promise<void> {
    await call('download:cancel', { id })
  }

  async function remove(id: string, deleteFile = false): Promise<void> {
    await call('download:remove', { id, deleteFile })
    tasks.value = tasks.value.filter(t => t.id !== id)
  }

  async function clear(onlyFinished = true): Promise<void> {
    await call('download:clear', { onlyFinished })
    tasks.value = onlyFinished ? active.value : []
  }

  async function openDir(): Promise<void> {
    await call('download:openDir')
  }

  async function pickDir(): Promise<string> {
    const p = await call<string>('download:pickDir')
    if (p) dir.value = p
    return p || ''
  }

  function fmtBytes(n: number): string {
    if (!n) return '0 B'
    if (n < 1024) return `${n} B`
    if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`
    if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`
    return `${(n / 1073741824).toFixed(2)} GB`
  }

  return {
    tasks,
    dir,
    panelOpen,
    active,
    finished,
    runningCount,
    init,
    add,
    cancel,
    remove,
    clear,
    openDir,
    pickDir,
    fmtBytes,
  }
})

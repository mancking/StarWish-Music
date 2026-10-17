<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import Modal from './Modal.vue'
import Icon from './Icon.vue'
import { call } from '@/api'
import { useUiStore } from '@/stores/ui'
import { useLibraryStore } from '@/stores/library'
import type { Song } from '@shared/types'

const ui = useUiStore()
const library = useLibraryStore()
const router = useRouter()

const open = computed({
  get: () => ui.importDialog,
  set: v => {
    ui.importDialog = v
  },
})

const input = ref('')
const busy = ref(false)
const error = ref('')

async function submit(): Promise<void> {
  const text = input.value.trim()
  if (!text) {
    error.value = '请粘贴歌单链接或 ID'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const r = await call<{ name: string; pic: string; description: string; songs: Song[]; platform: string }>(
      'music:importPlaylist',
      { input: text }
    )
    if (!r.songs.length) throw new Error('该歌单没有可导入的歌曲')
    const pl = await library.createPlaylist(r.name || '导入的歌单')
    if (!pl) throw new Error('创建本地歌单失败')
    await library.addSongsToPlaylist(pl.id, r.songs)
    await call('db:playlist:update', { id: pl.id, patch: { pic: r.pic, description: r.description } })
    await library.refreshPlaylists()
    ui.toast(`已导入 ${r.songs.length} 首歌曲`, 'success')
    open.value = false
    input.value = ''
    router.push(`/playlist/${pl.id}`)
  } catch (e: any) {
    error.value = e?.message || '导入失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Modal v-model="open" title="导入平台歌单" :width="500">
    <p class="tip">粘贴任意主流音乐平台或视频合集的分享链接，系统会自动识别来源并保存为本地歌单，可离线浏览列表。</p>

    <textarea
      v-model="input"
      class="textarea"
      rows="3"
      spellcheck="false"
      placeholder="粘贴歌单 / 合集分享链接"
      @keydown.ctrl.enter="submit"
    />

    <div v-if="error" class="error"><Icon name="info" :size="14" />{{ error }}</div>

    <template #footer>
      <button class="btn ghost" @click="open = false">取消</button>
      <button class="btn primary" :disabled="busy" @click="submit">
        <Icon v-if="busy" name="loading" :size="15" class="spin" />
        {{ busy ? '解析中…' : '开始导入' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.tip {
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.7;
  margin-bottom: 12px;
}
.textarea {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--line-2);
  background: var(--panel);
  outline: none;
  font-size: 12.5px;
  resize: vertical;
  line-height: 1.6;
}
.textarea:focus {
  border-color: var(--accent);
}
.error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: 12px;
  color: #ff7a8c;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

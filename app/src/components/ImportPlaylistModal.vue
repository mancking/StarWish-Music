<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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

/** 支持的音源（与 importPlaylistByLink 中可识别的平台一致） */
const PLATFORMS: { key: string; name: string; hint: string }[] = [
  { key: 'wy', name: '小芸音乐', hint: '分享歌单 / ID' },
  { key: 'qq', name: '小秋音乐', hint: '分享歌单 / ID' },
  { key: 'kg', name: '小枸音乐', hint: '分享歌单 / 歌单 ID' },
  { key: 'kw', name: '小蜗音乐', hint: '分享歌单 / ID' },
  { key: 'mg', name: '小蜜音乐', hint: '分享歌单 / ID' },
  { key: 'bili', name: '视频源', hint: 'B站合集 / 收藏夹' },
]

/** 域名 → 音源 key。粘贴链接后自动切到对应音源（与落雪 deeplink 同思路） */
const HOST_PLATFORM: [RegExp, string][] = [
  [/bilibili\.com|b23\.tv/i, 'bili'],
  [/y\.qq\.com|qq\.com|c\.y\.qq/i, 'qq'],
  [/kugou\.com/i, 'kg'],
  [/kuwo\.cn/i, 'kw'],
  [/migu\.cn/i, 'mg'],
  [/music\.163\.com|163cn\.tv/i, 'wy'],
]

function detectPlatform(text: string): string {
  for (const [re, key] of HOST_PLATFORM) if (re.test(text)) return key
  return ''
}

const platform = ref<string>(PLATFORMS[0].key)
const input = ref('')
const busy = ref(false)
const error = ref('')

// 打开时重置状态
watch(open, v => {
  if (v) {
    error.value = ''
    input.value = ''
    platform.value = PLATFORMS[0].key
  }
})

// 粘贴链接后自动切到对应音源：不同平台的分享链接不互通，切对了才解析得动
const detectedPlatform = ref('')
watch(input, v => {
  const key = detectPlatform(v)
  detectedPlatform.value = key
  if (key && key !== platform.value) platform.value = key
  if (error.value) error.value = ''
})

/** 选中的音源与链接所属平台不一致时先提醒，省得白等一次请求 */
const platformMismatch = computed(() => {
  const d = detectedPlatform.value
  return !!(d && d !== platform.value)
})

const current = computed(() => PLATFORMS.find(p => p.key === platform.value) || PLATFORMS[0])

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
      { input: text, platform: platform.value }
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
  <Modal v-model="open" title="导入歌单" :width="640" :padding="0">
    <div class="layout">
      <!-- 左侧音源选择 -->
      <aside class="side">
        <div class="side-label">选择音源</div>
        <button
          v-for="p in PLATFORMS"
          :key="p.key"
          class="side-item"
          :class="{ active: platform === p.key }"
          @click="platform = p.key"
        >
          <span class="dot" :class="p.key" />
          <span class="info">
            <span class="name">{{ p.name }}</span>
            <span class="hint">{{ p.hint }}</span>
          </span>
          <Icon v-if="platform === p.key" name="check" :size="13" class="ck" />
        </button>
      </aside>

      <!-- 右侧输入区 -->
      <div class="main">
        <div class="row">
          <div class="in-wrap">
            <Icon name="external" :size="14" class="in-icon" />
            <input
              v-model="input"
              class="input"
              type="text"
              spellcheck="false"
              placeholder="输入歌单链接或歌单 ID"
              @keydown.enter="submit"
            />
          </div>
          <button class="btn primary" :disabled="busy" @click="submit">
            <Icon v-if="busy" name="loading" :size="14" class="spin" />
            <span>{{ busy ? '解析中…' : '打开' }}</span>
          </button>
        </div>

        <div v-if="error" class="error">
          <Icon name="info" :size="14" />{{ error }}
        </div>

        <div v-else-if="platformMismatch" class="error warn">
          <Icon name="info" :size="14" />
          该链接属于「{{ PLATFORMS.find(p => p.key === detectedPlatform)?.name }}」，当前选的是「{{ current.name }}」
        </div>

        <div class="tip">
          <p>粘贴链接后会自动切换到对应音源；不同音源的分享链接不互通。</p>
          <p>支持用歌单 ID 或概念版链接打开；部分平台（如 B站合集）需登录态或 Cookie 才能解析。</p>
        </div>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.layout {
  display: flex;
  min-height: 240px;
}
.side {
  width: 200px;
  flex: none;
  background: var(--panel);
  border-right: 1px solid var(--line);
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.side-label {
  font-size: 10.5px;
  color: var(--text-3);
  letter-spacing: 1.2px;
  padding: 0 10px 8px;
  text-transform: uppercase;
}
.side-item {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 38px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--text-2);
  text-align: left;
  transition: background 0.12s, color 0.12s;
}
.side-item:hover {
  background: var(--hover);
  color: var(--text);
}
.side-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-3);
  flex: none;
}
.dot.wy {
  background: #c20c0c;
}
.dot.qq {
  background: #2db24c;
}
.dot.kg {
  background: #2c8af8;
}
.dot.kw {
  background: #ff6f00;
}
.dot.mg {
  background: #ff5470;
}
.dot.bili {
  background: #00a1d6;
}
.info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.name {
  font-size: 12.5px;
  font-weight: 500;
}
.hint {
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.side-item.active .hint {
  color: var(--accent);
  opacity: 0.7;
}
.ck {
  flex: none;
  color: var(--accent);
}
.main {
  flex: 1;
  min-width: 0;
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.in-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--line-2);
  background: var(--panel);
  transition: border-color 0.15s, background 0.15s;
}
.in-wrap:focus-within {
  border-color: var(--accent);
  background: var(--panel-2);
}
.in-icon {
  color: var(--text-3);
  flex: none;
  margin-right: 6px;
}
.input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: none;
  font-size: 12.5px;
  color: var(--text);
}
.input::placeholder {
  color: var(--text-3);
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 18px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 500;
  background: var(--accent);
  color: #fff;
  border: none;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
}
.btn:hover {
  opacity: 0.92;
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.error {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #ff7a8c;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(255, 122, 140, 0.08);
}
/* 只是提醒（选了别的音源），不当作错误 */
.error.warn {
  color: var(--text-2);
  background: var(--hover);
}
.tip {
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px dashed var(--line);
  font-size: 11.5px;
  color: var(--text-3);
  line-height: 1.7;
}
.tip p + p {
  margin-top: 4px;
}
</style>

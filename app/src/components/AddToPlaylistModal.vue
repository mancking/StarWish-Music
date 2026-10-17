<script setup lang="ts">
import { computed, ref } from 'vue'
import Modal from './Modal.vue'
import Icon from './Icon.vue'
import Cover from './Cover.vue'
import { useUiStore } from '@/stores/ui'
import { useLibraryStore } from '@/stores/library'

const ui = useUiStore()
const library = useLibraryStore()
const creating = ref(false)
const name = ref('')
const busy = ref(false)

const open = computed({
  get: () => !!ui.playlistPickerSong,
  set: v => {
    if (!v) ui.playlistPickerSong = null
  },
})

async function addTo(id: string): Promise<void> {
  const song = ui.playlistPickerSong
  if (!song || busy.value) return
  busy.value = true
  try {
    await library.addSongsToPlaylist(id, [song])
    open.value = false
  } finally {
    busy.value = false
  }
}

async function createAndAdd(): Promise<void> {
  const n = name.value.trim()
  if (!n) return
  const pl = await library.createPlaylist(n)
  if (pl) {
    await addTo(pl.id)
    creating.value = false
    name.value = ''
  }
}
</script>

<template>
  <Modal v-model="open" title="添加到歌单" :width="420">
    <div class="song-line" v-if="ui.playlistPickerSong">
      <Cover :src="ui.playlistPickerSong.pic" :alt="ui.playlistPickerSong.name" :size="40" :radius="8" />
      <div class="meta">
        <div class="ellipsis">{{ ui.playlistPickerSong.name }}</div>
        <div class="sub ellipsis">{{ ui.playlistPickerSong.singer }}</div>
      </div>
    </div>

    <div class="pl-list">
      <button v-for="pl in library.playlists" :key="pl.id" class="pl-row" :disabled="busy" @click="addTo(pl.id)">
        <Icon name="list" :size="16" />
        <span class="ellipsis">{{ pl.name }}</span>
        <span class="cnt">{{ pl.songCount ?? 0 }}</span>
      </button>
      <div v-if="!library.playlists.length" class="empty" style="padding: 22px">
        <div class="empty-desc">还没有歌单，先创建一个吧</div>
      </div>
    </div>

    <div v-if="creating" class="new-row">
      <input v-model="name" class="input" placeholder="新歌单名称" maxlength="30" autofocus @keydown.enter="createAndAdd" />
      <button class="btn primary sm" @click="createAndAdd">创建并添加</button>
    </div>
    <button v-else class="btn ghost new-btn" @click="creating = true"><Icon name="plus" :size="15" />新建歌单</button>
  </Modal>
</template>

<style scoped>
.song-line {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 10px;
  background: var(--panel);
  margin-bottom: 12px;
}
.meta {
  min-width: 0;
}
.sub {
  font-size: 11.5px;
  color: var(--text-3);
}
.pl-list {
  max-height: 280px;
  overflow-y: auto;
}
.pl-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 9px 10px;
  border-radius: 9px;
  font-size: 12.5px;
  text-align: left;
  color: var(--text);
}
.pl-row span:first-of-type {
  flex: 1;
}
.pl-row:hover {
  background: var(--hover);
}
.cnt {
  font-size: 11px;
  color: var(--text-3);
}
.new-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.input {
  flex: 1;
  height: 32px;
  padding: 0 10px;
  border-radius: 9px;
  border: 1px solid var(--line-2);
  background: var(--panel);
  outline: none;
  font-size: 12.5px;
}
.input:focus {
  border-color: var(--accent);
}
.new-btn {
  margin-top: 10px;
  width: 100%;
}
</style>

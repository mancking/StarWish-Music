declare namespace AnyListen {
  namespace IPCDislikeList {
    interface ListInfo {
      lastSyncDate?: number
      snapshotKey: string
    }

    type ActionList =
      | IPCAction<'dislike_data_overwrite', Dislike.DislikeRules>
      | IPCAction<'dislike_music_add', Dislike.DislikeMusicInfo[]>
      | IPCAction<'dislike_music_clear'>

    type SyncMode =
      | 'merge_local_remote'
      | 'merge_remote_local'
      | 'overwrite_local_remote'
      | 'overwrite_remote_local'
      // | 'none'
      | 'cancel'

    type ServerActions = WarpPromiseRecord<{
      getDislikeInfo: () => Dislike.DislikeInfo
      dislikeAction: (action: ActionList) => void
    }>
    type ServerIPCActions<Socket = undefined> = IPC.WarpIPCHandlerActions<Socket, ServerActions>

    type ClientActions = WarpPromiseRecord<{
      dislikeAction: (action: ActionList) => void
    }>
    type ClientIPCActions<Socket = undefined> = IPC.WarpIPCHandlerActions<Socket, ClientActions>
  }
}

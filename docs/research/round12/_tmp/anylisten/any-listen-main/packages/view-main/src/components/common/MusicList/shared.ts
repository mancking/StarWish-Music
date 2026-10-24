import type { ListInfo } from './type'

export const getListMetaInfo = (listInfo: ListInfo) => {
  switch (listInfo.type) {
    case 'default':
    case 'general':
    case 'local':
      return undefined
    default:
      return listInfo.listMeta
  }
}

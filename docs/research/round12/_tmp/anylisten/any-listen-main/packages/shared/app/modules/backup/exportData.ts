import { filterFileName } from '@any-listen/common/utils'
import { joinPath, saveStrToFile } from '@any-listen/nodejs'

const buildListData = (datas: AnyListen.List.ListDataFull) => {
  const lists: Array<AnyListen.List.MyDefaultListInfoFull | AnyListen.List.MyLoveListInfoFull | AnyListen.List.UserListInfoFull> =
    []
  lists.push(datas.loveList)
  lists.push(datas.defaultList)
  for (const l of datas.userList) lists.push(l)
  return lists
}
/**
 * 导出列表到txt文件
 * @param savePath 保存路径
 * @param datas 列表数据
 * @param isMerge 是否合并
 */
export const exportPlayListToText = async (savePath: string, datas: AnyListen.List.ListDataFull, isMerge: boolean) => {
  const iconv = await import('iconv-lite')

  const lists = buildListData(datas)
  if (isMerge) {
    await saveStrToFile(
      savePath,
      iconv.encode(
        lists.map((l) => l.list.map((m) => `${m.name}  ${m.singer}  ${m.meta.albumName || ''}`).join('\n')).join('\n\n'),
        'utf8',
        { addBOM: true }
      )
    )
  } else {
    for await (const list of lists) {
      await saveStrToFile(
        joinPath(savePath, `any-listen_list_${filterFileName(list.name)}.txt`),
        iconv.encode(list.list.map((m) => `${m.name}  ${m.singer}  ${m.meta.albumName || ''}`).join('\n'), 'utf8', {
          addBOM: true,
        })
      )
    }
  }
}

/**
 * 导出列表到csv文件
 * @param savePath 保存路径
 * @param datas 列表数据
 * @param isMerge 是否合并
 * @param header 表头名称
 */
export const exportPlayListToCSV = async (
  savePath: string,
  datas: AnyListen.List.ListDataFull,
  isMerge: boolean,
  header: string
) => {
  const iconv = await import('iconv-lite')
  const lists = buildListData(datas)

  const filterStr = (str: string) => {
    if (!str) return ''
    str = str.replace(/"/g, '""')
    if (str.includes(',')) str = `"${str}"`
    return str
  }

  if (isMerge) {
    await saveStrToFile(
      savePath,
      iconv.encode(
        header +
          lists
            .map((l) =>
              l.list.map((m) => `${filterStr(m.name)},${filterStr(m.singer)},${filterStr(m.meta.albumName || '')}`).join('\n')
            )
            .join('\n'),
        'utf8',
        { addBOM: true }
      )
    )
  } else {
    for await (const list of lists) {
      await saveStrToFile(
        joinPath(savePath, `any-listen_list_${filterFileName(list.name)}.csv`),
        iconv.encode(
          header +
            list.list.map((m) => `${filterStr(m.name)},${filterStr(m.singer)},${filterStr(m.meta.albumName || '')}`).join('\n'),
          'utf8',
          { addBOM: true }
        )
      )
    }
  }
}

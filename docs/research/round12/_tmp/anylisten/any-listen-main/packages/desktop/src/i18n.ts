import { DEFAULT_LANG } from '@any-listen/common/constants'
import type { Langs, Locale, Message, TranslateValues } from '@any-listen/i18n'
import { fillMessage, langList, messages } from '@any-listen/i18n'
import SingleEvent from '@any-listen/nodejs/SimpleSingleEvent'

import { appEvent, appState, updateSetting } from './app'
import { getSystemLocale } from './shared/electron'

export const languageChangeEvent = new SingleEvent<[Langs]>()

export const i18n = {
  locale: DEFAULT_LANG as Locale,
  fallbackLocale: DEFAULT_LANG as Langs,
  availableLocales: Object.keys(messages) as Langs[],
  messages,
  message: messages[DEFAULT_LANG],
  setLanguage(locale?: Locale | null) {
    if (!locale || !(locale in messages)) locale = this.fallbackLocale
    this.message = messages[locale as Langs]
    languageChangeEvent.emit(locale as Langs)
  },
  getMessage(key: keyof Message, val?: TranslateValues): string {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    let targetMessage = this.message[key] ?? this.messages[this.fallbackLocale][key] ?? key
    return val ? fillMessage(targetMessage, val) : targetMessage
  },
  t(key: keyof Message, val?: TranslateValues): string {
    return this.getMessage(key, val)
  },
}

export const setLanguage = (lang: Langs) => {
  i18n.setLanguage(lang)
}

const getLocale = async () => {
  let systemLocale = await getSystemLocale()
  if (i18n.availableLocales.includes(systemLocale as Langs)) return systemLocale as Langs

  for (const lang of langList) {
    if (lang.alternate == systemLocale) {
      return lang.locale
    }
  }

  if (systemLocale.includes('-')) {
    systemLocale = systemLocale.split('-')[0]
  }
  for (const loc of i18n.availableLocales) {
    if (loc.split('-')[0] === systemLocale) return loc
  }
  return DEFAULT_LANG
}

export const initI18n = async () => {
  appEvent.on('locale_change', (locale) => {
    i18n.setLanguage(locale)
  })
  if (appState.appSetting['common.langId'] == null) {
    const locale = await getLocale()
    updateSetting({ 'common.langId': locale })
  }
  i18n.setLanguage(appState.appSetting['common.langId'])
}

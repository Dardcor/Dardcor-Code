export const LOCALES = [
  "en",
  "vi",
  "zh-CN",
  "zh-TW",
  "ja",
  "pt-BR",
  "pt-PT",
  "ko",
  "es",
  "de",
  "fr",
  "he",
  "ar",
  "ru",
  "pl",
  "cs",
  "nl",
  "tr",
  "uk",
  "tl",
  "id",
  "km",
  "th",
  "hi",
  "bn",
  "ur",
  "ro",
  "sv",
  "it",
  "el",
  "hu",
  "fi",
  "da",
  "no",
  "fa",
];
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";

export const LOCALE_NAMES = {
  en: "English",
  vi: "Tiếng Việt",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
  "pt-BR": "Português (Brasil)",
  "pt-PT": "Português (Portugal)",
  ko: "한국어",
  es: "Español",
  de: "Deutsch",
  fr: "Français",
  he: "עברית",
  ar: "العربية",
  ru: "Русский",
  pl: "Polski",
  cs: "Čeština",
  nl: "Nederlands",
  tr: "Türkçe",
  uk: "Українська",
  tl: "Tagalog",
  id: "Bahasa Indonesia",
  th: "ไทย",
  km: "ខ្មែរ",
  hi: "हिन्दी",
  bn: "বাংলা",
  ur: "اردو",
  ro: "Română",
  sv: "Svenska",
  it: "Italiano",
  el: "Ελληνικά",
  hu: "Magyar",
  fi: "Suomi",
  da: "Dansk",
  no: "Norsk",
  fa: "فارسی",
};

export function normalizeLocale(locale) {
  if (!locale || typeof locale !== "string") return DEFAULT_LOCALE;
  const clean = locale.trim();
  if (LOCALES.includes(clean)) return clean;
  if (clean.startsWith("zh-HK") || clean.startsWith("zh-TW") || clean.startsWith("zh-Hant")) return "zh-TW";
  if (clean.startsWith("zh")) return "zh-CN";
  if (clean.startsWith("pt-PT")) return "pt-PT";
  if (clean.startsWith("pt")) return "pt-BR";
  const base = clean.split(/[-_]/)[0].toLowerCase();
  if (LOCALES.includes(base)) return base;
  return DEFAULT_LOCALE;
}

export function isSupportedLocale(locale) {
  return LOCALES.includes(locale);
}

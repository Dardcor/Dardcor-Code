import { GOOGLE_TTS_LANGUAGES } from "./googleTtsLanguages.js";

const VOICES = {
  alloy:   { id: "alloy",   name: "Alloy" },
  ash:     { id: "ash",     name: "Ash" },
  ballad:  { id: "ballad",  name: "Ballad" },
  cedar:   { id: "cedar",   name: "Cedar" },
  coral:   { id: "coral",   name: "Coral" },
  echo:    { id: "echo",    name: "Echo" },
  fable:   { id: "fable",   name: "Fable" },
  marin:   { id: "marin",   name: "Marin" },
  nova:    { id: "nova",    name: "Nova" },
  onyx:    { id: "onyx",    name: "Onyx" },
  sage:    { id: "sage",    name: "Sage" },
  shimmer: { id: "shimmer", name: "Shimmer" },
  verse:   { id: "verse",   name: "Verse" },
};

const v = (...keys) => keys.map((k) => ({ ...VOICES[k], type: "tts" }));

const VOICES_STANDARD = v("alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer");
const VOICES_FULL = v("alloy", "ash", "ballad", "cedar", "coral", "echo", "fable", "marin", "nova", "onyx", "sage", "shimmer", "verse");

const GEMINI_VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede",
  "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
  "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
].map((id) => ({ id, name: id, type: "tts" }));

const MIMO_VOICES = [
  { id: "mimo_default", name: "mimo_default" },
  { id: "冰糖",           name: "冰糖" },
  { id: "茉莉",           name: "茉莉" },
  { id: "苏打",           name: "苏打" },
  { id: "白桦",           name: "白桦" },
  { id: "Mia",           name: "Mia" },
  { id: "Chloe",         name: "Chloe" },
  { id: "Milo",          name: "Milo" },
  { id: "Dean",          name: "Dean" },
].map((v) => ({ type: "tts", ...v }));

export const TTS_MODELS_CONFIG = {
  openai: {
    models: [
      { id: "gpt-4o-mini-tts", name: "GPT-4o Mini TTS", type: "tts" },
      { id: "tts-1-hd",        name: "TTS-1 HD",        type: "tts" },
      { id: "tts-1",           name: "TTS-1",           type: "tts" },
    ],
    voices: {
      "gpt-4o-mini-tts": VOICES_FULL,
      "tts-1":           VOICES_STANDARD,
      "tts-1-hd":        VOICES_STANDARD,
    },
    allVoices: VOICES_FULL,
  },
  openrouter: {
    models: [
      { id: "openai/gpt-4o-mini-tts", name: "GPT-4o Mini TTS", type: "tts" },
      { id: "openai/tts-1-hd",        name: "TTS-1 HD",        type: "tts" },
      { id: "openai/tts-1",           name: "TTS-1",           type: "tts" },
    ],
    voices: {
      "openai/gpt-4o-mini-tts": VOICES_FULL,
      "openai/tts-1":           VOICES_STANDARD,
      "openai/tts-1-hd":        VOICES_STANDARD,
    },
    allVoices: VOICES_FULL,
  },
  elevenlabs: {
    models: [
      { id: "eleven_flash_v2_5",      name: "Flash v2.5 (Fastest)",      type: "tts" },
      { id: "eleven_turbo_v2_5",      name: "Turbo v2.5 (Fast)",         type: "tts" },
      { id: "eleven_multilingual_v2", name: "Multilingual v2 (Quality)",  type: "tts" },
      { id: "eleven_monolingual_v1",  name: "Monolingual v1 (English)",  type: "tts" },
    ],
  },
  "edge-tts": {
    defaults: [
      { id: "en-US-AriaNeural",    name: "Aria (en-US)",    type: "tts" },
      { id: "en-US-GuyNeural",     name: "Guy (en-US)",     type: "tts" },
      { id: "en-GB-SoniaNeural",   name: "Sonia (en-GB)",   type: "tts" },
      { id: "vi-VN-HoaiMyNeural",  name: "Hoai My (vi-VN)", type: "tts" },
      { id: "vi-VN-NamMinhNeural", name: "Nam Minh (vi-VN)", type: "tts" },
      { id: "zh-CN-XiaoxiaoNeural", name: "Xiaoxiao (zh-CN)", type: "tts" },
      { id: "zh-CN-YunxiNeural",   name: "Yunxi (zh-CN)",   type: "tts" },
      { id: "fr-FR-DeniseNeural",  name: "Denise (fr-FR)",  type: "tts" },
      { id: "de-DE-KatjaNeural",   name: "Katja (de-DE)",   type: "tts" },
      { id: "ja-JP-NanamiNeural",  name: "Nanami (ja-JP)",  type: "tts" },
      { id: "ko-KR-SunHiNeural",   name: "SunHi (ko-KR)",   type: "tts" },
    ],
  },
  "local-device": {
    defaults: [
      { id: "default", name: "System Default Voice", type: "tts" },
    ],
  },
  "google-tts": {
    defaults: GOOGLE_TTS_LANGUAGES,
  },
  gemini: {
    models: [
      { id: "gemini-3.1-flash-tts-preview", name: "Gemini 3.1 Flash TTS", type: "tts" },
      { id: "gemini-2.5-flash-preview-tts", name: "Gemini 2.5 Flash TTS", type: "tts" },
      { id: "gemini-2.5-pro-preview-tts",   name: "Gemini 2.5 Pro TTS",   type: "tts" },
    ],
    voices: {
      "gemini-3.1-flash-tts-preview": GEMINI_VOICES,
      "gemini-2.5-flash-preview-tts": GEMINI_VOICES,
      "gemini-2.5-pro-preview-tts":   GEMINI_VOICES,
    },
    allVoices: GEMINI_VOICES,
  },
  "xiaomi-mimo": {
    models: [
      { id: "mimo-v2.5-tts", name: "MiMo V2.5 TTS", type: "tts" },
    ],
    voices: {
      "mimo-v2.5-tts": MIMO_VOICES,
    },
  },
};

export function getTtsVoicesForModel(provider, modelId) {
  const cfg = TTS_MODELS_CONFIG[provider];
  if (!cfg?.voices) return null;
  return cfg.voices[modelId] || cfg.allVoices || null;
}

export function buildTtsProviderModels() {
  const entries = {};
  for (const [provider, cfg] of Object.entries(TTS_MODELS_CONFIG)) {
    if (cfg.models) entries[`${provider}-tts-models`] = cfg.models;
    if (cfg.allVoices) entries[`${provider}-tts-voices`] = cfg.allVoices;
    if (cfg.defaults) entries[provider] = cfg.defaults;
  }
  entries["openai-tts-voices"] = TTS_MODELS_CONFIG.openai.allVoices;
  entries["openrouter-tts-voices"] = TTS_MODELS_CONFIG.openrouter.allVoices;
  return entries;
}

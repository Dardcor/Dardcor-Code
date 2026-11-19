
const SEP = "[-_/:.]";

const NOT_VISION = new RegExp(
  [
    `(^|${SEP})(image|img)(${SEP}|$)`,
    "stable-image", "gen[0-9]_image", "nanobanana", "imagine",
    "t2v", "i2v", "flux", "dall", "sdxl", "diffusion",
    "embed", "rerank", "guard", "moderation",
    "tts", "stt", "whisper", "voice", "speech", "audio",
  ].join("|"),
  "i"
);

const VISION_NAME = new RegExp(
  [
    `(^|${SEP})(vision|vl|vlm|multimodal|omni|visual)(${SEP}|$)`,
    `[0-9]\\.[0-9]+v(${SEP}|$)`,
    `(^|${SEP})glm-[0-9]+v(${SEP}|$)`,
    "(^|[-_/:.])(llava|pixtral|internvl|cogvlm|minicpm-v|moondream|idefics|fuyu)",
  ].join("|"),
  "i"
);

export function looksLikeVisionModel(modelId) {
  if (!modelId) return false;
  const id = String(modelId).toLowerCase();
  if (NOT_VISION.test(id)) return false;
  return VISION_NAME.test(id);
}

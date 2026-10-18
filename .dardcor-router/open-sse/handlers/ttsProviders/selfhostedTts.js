import { Buffer } from "node:buffer";

const DEFAULT_BASE_URL = "http://localhost:8880";
const DEFAULT_MODEL = "kokoro";
const DEFAULT_VOICE = "af_heart";

export default {
  async synthesize(text, model, credentials, responseFormat = "mp3") {
    const raw = credentials?.providerSpecificData?.baseUrl || credentials?.baseUrl || DEFAULT_BASE_URL;
    const base = String(raw)
      .replace(/\/+$/, "")
      .replace(/\/v1\/audio\/speech$/, "")
      .replace(/\/v1$/, "");

    let ttsModel = DEFAULT_MODEL;
    let voice = DEFAULT_VOICE;
    if (model) {
      const parts = String(model).split("/").filter(Boolean);
      if (parts.length >= 2) {
        ttsModel = parts[0];
        voice = parts.slice(1).join("/");
      } else if (parts.length === 1) {
        ttsModel = parts[0];
      }
    }

    const res = await fetch(`${base}/v1/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(credentials?.apiKey ? { Authorization: `Bearer ${credentials.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: ttsModel,
        voice,
        input: text,
        response_format: responseFormat,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Self-hosted TTS failed: ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    return { base64: Buffer.from(buf).toString("base64"), format: responseFormat };
  },
};

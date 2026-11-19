import { AI_PROVIDERS } from "@/shared/constants/providers";

const PROVIDER_API = {
  elevenlabs: (origin) => `${origin}/api/media-providers/tts/elevenlabs/voices`,
  deepgram: (origin) => `${origin}/api/media-providers/tts/deepgram/voices`,
  inworld: (origin) => `${origin}/api/media-providers/tts/inworld/voices`,
  "edge-tts": (origin) => `${origin}/api/media-providers/tts/voices?provider=edge-tts`,
  "local-device": (origin) => `${origin}/api/media-providers/tts/voices?provider=local-device`,
};

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
}

export async function GET(request) {
  try {
    const { searchParams, origin } = new URL(request.url);
    const provider = searchParams.get("provider");
    const lang = searchParams.get("lang");

    if (!provider || !PROVIDER_API[provider]) {
      return Response.json(
        { error: { message: `provider must be one of: ${Object.keys(PROVIDER_API).join(", ")}`, type: "invalid_request_error" } },
        { status: 400, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    const baseUrl = PROVIDER_API[provider](origin);
    const url = lang ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}lang=${encodeURIComponent(lang)}` : baseUrl;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok || data.error) {
      return Response.json(
        { error: { message: data.error || `Upstream ${res.status}`, type: "server_error" } },
        { status: res.status, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    const rawVoices = lang
      ? (data.voices || [])
      : Object.values(data.byLang || {}).flatMap((l) => l.voices || []);

    const alias = AI_PROVIDERS[provider]?.alias || provider;
    const data_out = rawVoices.map((v) => ({
      id: v.id,
      name: v.name,
      lang: v.lang || "",
      gender: v.gender || "",
      model: `${alias}/${v.id}`,
    }));

    return Response.json({ object: "list", data: data_out }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return Response.json(
      { error: { message: err.message || "Failed", type: "server_error" } },
      { status: 502, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
}

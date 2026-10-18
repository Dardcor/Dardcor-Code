import { NextResponse } from "next/server";

const KILO_MODELS_URL = "https://api.kilo.ai/api/gateway/models";

let cachedModels = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 60 * 1000;

export async function GET() {
  const now = Date.now();

  if (cachedModels && now - cacheTimestamp < CACHE_TTL_MS) {
    return NextResponse.json({ models: cachedModels, cached: true });
  }

  try {
    const res = await fetch(KILO_MODELS_URL, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      throw new Error(`Kilo API returned ${res.status}`);
    }

    const json = await res.json();
    const allModels = json.data || [];

    const freeModels = allModels
      .filter((m) => m.isFree === true)
      .map((m) => ({
        id: m.id,
        name: m.name,
        isFree: true,
        context_length: m.context_length || 0,
      }));

    cachedModels = freeModels;
    cacheTimestamp = now;

    return NextResponse.json({ models: freeModels, cached: false });
  } catch (error) {
    if (cachedModels) {
      return NextResponse.json({ models: cachedModels, cached: true, warning: error.message });
    }

    return NextResponse.json(
      { models: [], error: `Failed to fetch Kilo models: ${error.message}` },
      { status: 502 }
    );
  }
}

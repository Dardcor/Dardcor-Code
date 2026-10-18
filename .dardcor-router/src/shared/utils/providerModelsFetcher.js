
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

export async function fetchSuggestedModels(fetcher) {
  if (!fetcher?.url || !fetcher?.type) return [];

  const cached = cache.get(fetcher.url);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  try {
    const params = new URLSearchParams({ url: fetcher.url, type: fetcher.type });
    const res = await fetch(`/api/providers/suggested-models?${params}`);
    if (!res.ok) return [];
    const json = await res.json();
    const data = json.data ?? [];
    cache.set(fetcher.url, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch {
    return [];
  }
}

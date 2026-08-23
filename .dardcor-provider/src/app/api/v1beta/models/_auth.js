import { getSettings } from "@/lib/localDb";
import { isValidApiKey } from "@/sse/services/auth.js";

/**
 * Extract the client API key from a Gemini-native request, matching what the
 * @google/genai SDK and Gemini CLI send: Authorization Bearer header,
 * x-goog-api-key header, or ?key= query parameter (in that order).
 */
export function extractGeminiClientApiKey(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);

  const googleApiKey = request.headers.get("x-goog-api-key");
  if (googleApiKey) return googleApiKey;

  const url = new URL(request.url);
  return url.searchParams.get("key");
}

/**
 * Gate a Gemini-native request on the effective requireApiKey setting.
 * Returns null when the request is allowed, or a 401 { status, message }
 * result when a key is required but missing or invalid.
 */
export async function validateGeminiClientKey(request) {
  const settings = await getSettings();
  if (!settings.requireApiKey) return null;

  const apiKey = extractGeminiClientApiKey(request);
  if (!apiKey) return { status: 401, message: "Missing API key" };

  const valid = await isValidApiKey(apiKey);
  if (!valid) return { status: 401, message: "Invalid API key" };

  return null;
}

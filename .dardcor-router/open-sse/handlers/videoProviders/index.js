import openrouter from "./openrouter.js";
import vertex from "./vertex.js";

const ADAPTERS = { openrouter, vertex };

export function getVideoAdapter(provider) {
  return ADAPTERS[provider] || null;
}

export { cn } from "./cn";
export * as api from "./api";
export { getProviderIconSrc, markProviderIconMissing, resolveProviderIconId } from "./providerIcon";

import { v4 as uuidv4 } from "uuid";

export const generateId = uuidv4;

export function getErrorCode(lastError) {
  if (!lastError) return null;
  const match = lastError.match(/\b([45]\d{2})\b/);
  return match ? match[1] : "ERR";
}

export function getRelativeTime(isoDate) {
  if (!isoDate) return "";
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}


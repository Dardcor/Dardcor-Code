
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";

export const CATALOG_FILE = path.join(DATA_DIR, "model-catalog.json");
export const CATALOG_RAW_FILE = path.join(DATA_DIR, "model-catalog-raw.json");

const EMPTY = { models: {}, providers: {} };
let cache = EMPTY;
let cachedMtime = -1;

function baseId(model) {
  if (!model) return "";
  const withoutVendor = model.includes("/") ? model.split("/").pop() : model;
  return withoutVendor.toLowerCase().split(":")[0];
}

function load() {
  let mtime;
  try {
    mtime = fs.statSync(CATALOG_FILE).mtimeMs;
  } catch {
    cache = EMPTY;
    cachedMtime = -1;
    return cache;
  }
  if (mtime === cachedMtime) return cache;

  cachedMtime = mtime;
  try {
    const parsed = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
    cache = { models: parsed?.models || {}, providers: parsed?.providers || {} };
  } catch {
    cache = EMPTY;
  }
  return cache;
}

export function getCatalogModalities(model) {
  return load().models[baseId(model)] || null;
}

export function getCatalogLimits(provider, model) {
  const byProvider = provider && load().providers[provider];
  if (!byProvider) return null;
  return byProvider[model] || byProvider[baseId(model)] || null;
}

export function invalidateCatalog() {
  cachedMtime = -1;
}

export async function installCatalogSource() {
  const { setCatalogSource } = await import("./capabilities.js");
  setCatalogSource({ getModalities: getCatalogModalities, getLimits: getCatalogLimits });
}

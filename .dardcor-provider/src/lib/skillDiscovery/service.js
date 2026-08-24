import path from "node:path";
import fs from "node:fs/promises";
import { SKILLS } from "@/shared/constants/skills";
import { DATA_DIR } from "@/lib/dataDir";
import {
  normalizeLocalSkill,
  fetchSkillsShSearch,
  fetchSkillsShCatalog,
  SKILLS_SH_BASE,
  SKILLS_SH_MIN_QUERY,
} from "./sources";
import {
  DARDCOR CODE_TARGET,
  detectCliTargets,
  isKnownTarget,
  isKnownCliTarget,
  getInstallCommand,
  getTargetLabel,
} from "./targets";
import { createInstallStore } from "./store";
import { sanitizeSlug, sha256, redactMetadata } from "./security";
import { detectInstalledSkills } from "./installed";

const SOURCE_IDS = Object.freeze(["dardcor-code", "skills.sh"]);
const MAX_QUERY = 100;

function defaultFetch() {
  return fetch;
}

// In-memory cache for the skills.sh sitemap catalog. It is large (~1MB) and
// changes slowly, so we hold it briefly instead of walking sitemaps per request.
const CATALOG_TTL_MS = 10 * 60 * 1000;
let catalogCache = null;

async function getCatalogCached(fetchFn) {
  if (catalogCache && Date.now() - catalogCache.ts < CATALOG_TTL_MS) {
    return catalogCache;
  }
  const { skills } = await fetchSkillsShCatalog(fetchFn);
  catalogCache = {
    ts: Date.now(),
    skills,
    note: `showing ${skills.length} skills from the skills.sh catalog`,
  };
  return catalogCache;
}

function resetCatalogCache() {
  catalogCache = null;
}

function matchesQuery(item, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return [item.id, item.slug, item.name, item.description, item.sourceRef]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(q));
}

function matchesSource(item, source) {
  if (!source) return true;
  const wanted = String(source).split(",").filter(Boolean);
  if (wanted.length === 0) return true;
  return wanted.includes(item.source);
}

function matchesInstalled(item, installed) {
  if (installed === undefined || installed === null || installed === "") return true;
  const want = String(installed) === "true";
  return item.installed === want;
}

function localItems() {
  return SKILLS.map(normalizeLocalSkill);
}

/**
 * Load the local catalog plus (optionally) the allowlisted skills.sh remote
 * catalog. Remote failure never throws — it becomes an unavailable source.
 */
async function loadAll({ fetchImpl, query, useRemote = true } = {}) {
  const fetchFn = fetchImpl || defaultFetch();
  const local = localItems();

  const sources = [{ id: "dardcor-code", available: true, count: local.length, error: null }];
  let remote = [];
  const q = String(query || "").trim();

  if (useRemote) {
    if (q.length >= SKILLS_SH_MIN_QUERY) {
      try {
        const result = await fetchSkillsShSearch(q, fetchFn);
        remote = result.skills;
        sources.push({ id: "skills.sh", available: true, count: remote.length, error: null });
      } catch (error) {
        sources.push({
          id: "skills.sh",
          available: false,
          count: 0,
          error: error?.message ? String(error.message).slice(0, 200) : "Unavailable",
        });
      }
    } else {
      // Browse: skills.sh exposes no list API, so we walk its public sitemap.
      try {
        const result = await getCatalogCached(fetchFn);
        remote = result.skills;
        sources.push({
          id: "skills.sh",
          available: true,
          count: remote.length,
          error: null,
          note: result.note,
        });
      } catch (error) {
        sources.push({
          id: "skills.sh",
          available: false,
          count: 0,
          error: error?.message ? String(error.message).slice(0, 200) : "Unavailable",
        });
      }
    }
  } else {
    sources.push({
      id: "skills.sh",
      available: true,
      count: 0,
      error: null,
      note: null,
    });
  }

  return { items: [...local, ...remote], sources };
}

/**
 * Merge install-record and on-disk detection state into item `installed` flags.
 * `detect` is injectable for tests; it defaults to scanning this host's known
 * skill directories (cross-platform).
 */
async function resolveInstalled(items, { store, detect } = {}) {
  const recordStore = store || createInstallStore();
  let records = [];
  try {
    records = await recordStore.list();
  } catch {
    records = [];
  }
  const recordIds = new Set(records.map((r) => r.id));
  const recordSlugs = new Set(records.map((r) => r.slug));

  let detected = [];
  try {
    detected = await (detect ? detect() : detectInstalledSkills());
  } catch {
    detected = [];
  }
  const detectedSlugs = new Set(detected.map((d) => d.slug));

  return {
    items: items.map((item) => ({
      ...item,
      installed:
        item.installed ||
        recordIds.has(item.id) ||
        recordSlugs.has(item.slug) ||
        detectedSlugs.has(item.slug),
    })),
    detected,
  };
}

/**
 * List skills with bounded search and filters.
 */
export async function listSkills({ query, source, installed, fetchImpl, useRemote = true, cliTargets, store, detect } = {}) {
  const bounded = String(query || "").slice(0, MAX_QUERY);
  const { items, sources } = await loadAll({ fetchImpl, query: bounded, useRemote });
  const resolved = await resolveInstalled(items, { store, detect });

  const filtered = resolved.items
    .filter((item) => matchesQuery(item, bounded))
    .filter((item) => matchesSource(item, source))
    .filter((item) => matchesInstalled(item, installed));

  const cli = cliTargets || detectCliTargets();
  const targets = [
    { id: DARDCOR CODE_TARGET, label: getTargetLabel(DARDCOR CODE_TARGET), available: true },
    ...cli.map((t) => ({ id: t.id, label: t.label, available: t.available })),
  ];

  return {
    items: filtered,
    counts: {
      total: resolved.items.length,
      filtered: filtered.length,
      local: resolved.items.filter((i) => i.source === "dardcor-code").length,
      remote: resolved.items.filter((i) => i.source === "skills.sh").length,
      installed: resolved.items.filter((i) => i.installed).length,
    },
    sources,
    targets,
    detected: resolved.detected,
  };
}

/**
 * Get a single skill by its fully-qualified id (`dardcor-code/<slug>` or
 * `skills.sh/<slug>`), including install targets and the canonical command.
 */
export async function getSkill(id, { fetchImpl, store, detect } = {}) {
  if (typeof id !== "string" || !id.trim()) return null;
  const { items } = await loadAll({ fetchImpl });
  const resolved = await resolveInstalled(items, { store, detect });
  const skill = resolved.items.find((item) => item.id === id || item.slug === id);
  if (skill) return skill;
  // skills.sh is search-only: resolve a remote skill by its slug.
  const slug = id.startsWith("skills.sh/") ? id.slice("skills.sh/".length) : id;
  if (slug.length < SKILLS_SH_MIN_QUERY) return null;
  try {
    const result = await fetchSkillsShSearch(slug, fetchImpl || defaultFetch());
    const remote = result.skills.find((s) => s.slug === slug) || null;
    if (!remote) return null;
    return resolveInstalled([remote], { store, detect }).then((r) => r.items[0]);
  } catch {
    return null;
  }
}

function manifestForSkill(skill) {
  const safe = redactMetadata(skill);
  return {
    name: skill.name,
    slug: sanitizeSlug(skill.slug),
    description: skill.description || "",
    source: skill.source,
    sourceRef: skill.sourceRef || null,
    installedAt: new Date().toISOString(),
    meta: safe || {},
  };
}

/**
 * Install a skill into the Dardcor Code global registry by writing a manifest
 * file under DATA_DIR/skills/<slug>/ and recording ownership. Never downloads
 * or executes third-party files.
 */
async function installToDardcor Code(skill, fsImpl, dataDir) {
  const fsx = fsImpl || fs;
  const base = dataDir || DATA_DIR;
  const slug = sanitizeSlug(skill.slug);
  const dir = path.join(base, "skills", slug);
  await fsx.mkdir(dir, { recursive: true });
  const manifest = manifestForSkill(skill);
  const filePath = path.join(dir, "skill.json");
  const content = JSON.stringify(manifest, null, 2);
  await fsx.writeFile(filePath, content, "utf8");
  return {
    id: DARDCOR CODE_TARGET,
    label: getTargetLabel(DARDCOR CODE_TARGET),
    installedAt: manifest.installedAt,
    ownedFiles: ["skill.json"],
    checksum: sha256(content),
    command: "",
  };
}

/**
 * Install a skill for one or more targets. CLI targets are recorded and their
 * canonical command returned — the server never executes shells or writes into
 * CLI directories.
 */
export async function installSkill(id, target, { cliId, fetchImpl, fsImpl, store, dataDir, cliTargets, detect } = {}) {
  if (!isKnownTarget(target)) {
    return { ok: false, code: "UNKNOWN_TARGET", error: "Unknown install target" };
  }
  const skill = await getSkill(id, { fetchImpl, store, detect });
  if (!skill) return { ok: false, code: "SKILL_NOT_FOUND", error: "Skill not found" };

  const recordStore = store || createInstallStore();
  const installedTargets = [];

  if (target === DARDCOR CODE_TARGET || target === "both") {
    installedTargets.push(await installToDardcor Code(skill, fsImpl, dataDir));
  }

  if (target !== DARDCOR CODE_TARGET) {
    const detected = (cliTargets || detectCliTargets()).filter((t) => t.available);
    const wanted = cliId ? detected.filter((t) => t.id === cliId) : detected;
    if (cliId && !isKnownCliTarget(cliId)) {
      return { ok: false, code: "UNKNOWN_CLI", error: "Unknown CLI target" };
    }
    if (cliId && wanted.length === 0) {
      return { ok: false, code: "CLI_NOT_DETECTED", error: `CLI target "${cliId}" is not installed on this host` };
    }
    if (target === "cli" && wanted.length === 0) {
      return { ok: false, code: "NO_CLI_DETECTED", error: "No supported CLI targets detected on this host" };
    }
    for (const cli of wanted) {
      installedTargets.push({
        id: cli.id,
        label: cli.label,
        installedAt: new Date().toISOString(),
        ownedFiles: [],
        checksum: null,
        command: getInstallCommand(skill, cli.id),
      });
    }
  }

  const record = {
    id: skill.id,
    slug: sanitizeSlug(skill.slug),
    name: skill.name,
    source: skill.source,
    targets: installedTargets.map((t) => ({
      id: t.id,
      installedAt: t.installedAt,
      ownedFiles: t.ownedFiles || [],
      command: t.command || "",
    })),
    updatedAt: new Date().toISOString(),
  };
  await recordStore.upsert(record);

  return {
    ok: true,
    installed: true,
    skill: { id: skill.id, name: skill.name, source: skill.source },
    targets: installedTargets,
  };
}

/**
 * Remove an install record and delete only files this installer owns for the
 * given target.
 */
export async function uninstallSkill(id, target, { fsImpl, store, dataDir } = {}) {
  if (target !== DARDCOR CODE_TARGET && !isKnownCliTarget(target)) {
    return { ok: false, code: "UNKNOWN_TARGET", error: "Unknown install target" };
  }
  const recordStore = store || createInstallStore();
  const record = await recordStore.get(id);
  if (!record) return { ok: false, code: "NOT_INSTALLED", error: "Skill is not installed" };
  const existing = (record.targets || []).find((t) => t.id === target);
  if (!existing) return { ok: false, code: "NOT_INSTALLED", error: `Skill is not installed for target "${target}"` };

  const removed = [];
  if (target === DARDCOR CODE_TARGET) {
    const fsx = fsImpl || fs;
    const base = dataDir || DATA_DIR;
    const dir = path.join(base, "skills", sanitizeSlug(record.slug));
    for (const file of existing.ownedFiles || []) {
      const filePath = path.join(dir, file);
      if (filePath.startsWith(path.join(base, "skills"))) {
        try {
          await fsx.unlink(filePath);
          removed.push(file);
        } catch {
          // missing file is fine — record still clears
        }
      }
    }
  }

  await recordStore.removeTarget(id, target);
  return { ok: true, installed: false, removed, target };
}

/** Read-only listing of current install records (no file contents). */
export async function listInstalled({ store } = {}) {
  const recordStore = store || createInstallStore();
  const records = await recordStore.list();
  return records.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    source: r.source,
    targets: (r.targets || []).map((t) => ({ id: t.id, installedAt: t.installedAt })),
    updatedAt: r.updatedAt,
  }));
}

export const __test__ = {
  loadAll,
  resolveInstalled,
  matchesQuery,
  matchesSource,
  matchesInstalled,
  manifestForSkill,
  resetCatalogCache,
  SKILLS_SH_BASE,
  SOURCE_IDS,
};

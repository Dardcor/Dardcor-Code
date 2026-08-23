import { SKILLS } from "@/shared/constants/skills";

// Explicit allowlist — only these remote origins are ever contacted.
export const ALLOWED_SOURCES = Object.freeze([
  "https://skills.sh",
  "https://www.skills.sh",
]);

export const SKILLS_SH_BASE = "https://skills.sh";
export const SKILLS_SH_WWW_BASE = "https://www.skills.sh";

// skills.sh has no public browse endpoint; its public API is search-only and
// requires a query of at least 2 characters. `/api/v1/skills*` is Vercel-OIDC
// gated (401) and is deliberately never called.
export const SKILLS_SH_MIN_QUERY = 2;

export function isAllowedSourceUrl(url) {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return ALLOWED_SOURCES.some((base) => {
      const b = new URL(base);
      return parsed.hostname === b.hostname;
    });
  } catch {
    return false;
  }
}

function asText(value, max) {
  return typeof value === "string" ? value.slice(0, max).trim() : "";
}

function asCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * Normalize a skills.sh search row into safe, secret-free metadata.
 *
 * Real search shape: { id: "owner/repo/skillId", skillId, name, installs, source }.
 * `name` equals `skillId` (the API exposes no separate human title), and there
 * is no description field — we never fabricate either.
 */
export function normalizeSkillsShSkill(row) {
  if (!row || typeof row !== "object") return null;
  const skillId = asText(row.skillId, 128) || asText(row.name, 128);
  if (!skillId) return null;

  const source = asText(row.source, 512);
  const installs = asCount(row.installs);
  const installCommand = source ? `npx skills add ${source} --skill ${skillId}` : "";

  return {
    id: `skills.sh/${skillId}`,
    slug: skillId,
    name: skillId,
    description: "",
    source: "skills.sh",
    sourceRef: source,
    url: null,
    installs,
    installed: false,
    builtin: false,
    installCommand,
  };
}

/** Local catalog skills are built-in and therefore already installed. */
export function normalizeLocalSkill(skill) {
  return {
    id: `miawrouter/${skill.id}`,
    slug: skill.id,
    name: skill.name,
    description: skill.description || "",
    source: "miawrouter",
    sourceRef: null,
    url: null,
    installs: 0,
    installed: true,
    builtin: true,
    installCommand: "",
    icon: skill.icon || null,
    endpoint: skill.endpoint || null,
    isEntry: skill.isEntry === true,
  };
}

/**
 * Search skills.sh. `fetchImpl` is injectable for tests. Callers must pass a
 * query of at least SKILLS_SH_MIN_QUERY characters.
 */
export async function fetchSkillsShSearch(query, fetchImpl, { baseUrl = SKILLS_SH_BASE, limit = 50 } = {}) {
  const q = String(query || "").trim().slice(0, 100);
  const params = new URLSearchParams();
  params.set("q", q);
  params.set("limit", String(Math.min(Math.max(1, limit), 100)));
  const url = `${baseUrl}/api/search?${params.toString()}`;
  const res = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`skills.sh search failed: ${res.status}`);
  const payload = await res.json();
  const rows = Array.isArray(payload?.skills) ? payload.skills : [];
  return { skills: rows.map(normalizeSkillsShSkill).filter(Boolean), raw: payload };
}

/** Extract `<loc>` URLs from a sitemap XML document. */
export function extractSitemapUrls(xml) {
  const urls = [];
  if (typeof xml !== "string") return urls;
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/g;
  let match;
  while ((match = re.exec(xml)) !== null) {
    urls.push(match[1].trim());
  }
  return urls;
}

/** Convert a `https://www.skills.sh/<owner>/<repo>/<slug>` URL into a skill. */
export function skillFromSkillUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (!ALLOWED_SOURCES.some((base) => parsed.hostname === new URL(base).hostname)) return null;
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 3) return null;
    const owner = segments[0];
    const repo = segments[1];
    const slug = segments[segments.length - 1];
    if (!owner || !repo || !slug) return null;
    return normalizeSkillsShSkill({ skillId: slug, source: `${owner}/${repo}` });
  } catch {
    return null;
  }
}

/**
 * Fetch the skills.sh public catalog by walking its sitemap index. skills.sh
 * has no authenticated browse API, but it publishes `sitemap-skills-*.xml`
 * listing every skill URL — this is the public, browsable list.
 *
 * `max` caps how many skills are returned (deduped by slug).
 */
export async function fetchSkillsShCatalog(fetchImpl, { baseUrl = SKILLS_SH_WWW_BASE, max = 100 } = {}) {
  const idxRes = await fetchImpl(`${baseUrl}/sitemap.xml`, { headers: { accept: "application/xml, text/xml, */*" } });
  if (!idxRes.ok) throw new Error(`skills.sh sitemap index failed: ${idxRes.status}`);
  const index = await idxRes.text();
  const sitemapUrls = extractSitemapUrls(index).filter((u) => /sitemap-skills/.test(u));

  const skills = [];
  const seen = new Set();
  for (const sitemapUrl of sitemapUrls) {
    if (skills.length >= max) break;
    const res = await fetchImpl(sitemapUrl, { headers: { accept: "application/xml, text/xml, */*" } });
    if (!res.ok) continue; // a broken sitemap shard is skipped, not fatal
    const xml = await res.text();
    for (const url of extractSitemapUrls(xml)) {
      const skill = skillFromSkillUrl(url);
      if (skill && !seen.has(skill.slug)) {
        seen.add(skill.slug);
        skills.push(skill);
      }
      if (skills.length >= max) break;
    }
  }
  return { skills, raw: { sitemapUrls, count: skills.length } };
}

export const __test__ = { normalizeSkillsShSkill, normalizeLocalSkill, isAllowedSourceUrl, extractSitemapUrls, skillFromSkillUrl };

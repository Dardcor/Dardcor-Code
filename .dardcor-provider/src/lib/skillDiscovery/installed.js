import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

// Known global skill directories across platforms. Paths are built from the
// user's home directory, so they resolve correctly on Windows, Linux, and
// Arch (XDG) alike.
const SKILL_ROOTS = Object.freeze([
  { id: "skills-cli", label: "Global (skills CLI)", rel: [".agents", "skills"] },
  { id: "claude", label: "Claude Code", rel: [".claude", "skills"] },
  { id: "codex", label: "Codex", rel: [".codex", "skills"] },
  { id: "opencode", label: "OpenCode", rel: [".config", "opencode", "skills"] },
  { id: "cursor", label: "Cursor", rel: [".cursor", "skills"] },
]);

export function skillRoots(homeDir = os.homedir()) {
  return SKILL_ROOTS.map((root) => ({
    id: root.id,
    label: root.label,
    dir: path.join(homeDir, ...root.rel),
  }));
}

/**
 * Detect skills already installed on this host by scanning known skill
 * directories for `<dir>/SKILL.md`. Only directory names and file existence
 * are read — never skill contents. No absolute paths are returned; each hit
 * is tagged with a source label.
 */
export async function detectInstalledSkills({ fsImpl, homeDir } = {}) {
  const fsx = fsImpl || fs;
  const found = [];
  for (const root of skillRoots(homeDir)) {
    let entries;
    try {
      entries = await fsx.readdir(root.dir, { withFileTypes: true });
    } catch {
      continue; // root does not exist on this host
    }
    for (const entry of entries) {
      if (!entry || typeof entry.isDirectory !== "function" || !entry.isDirectory()) continue;
      const skillFile = path.join(root.dir, entry.name, "SKILL.md");
      try {
        const stat = await fsx.stat(skillFile);
        if (stat.isFile()) {
          found.push({ slug: entry.name, name: entry.name, source: root.label });
        }
      } catch {
        // directory exists but no SKILL.md → not a skill
      }
    }
  }
  return found;
}

export const __test__ = { skillRoots, detectInstalledSkills };

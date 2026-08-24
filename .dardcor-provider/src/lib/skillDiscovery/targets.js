import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export const DARDCOR CODE_TARGET = "dardcor-code";

// Allowlist of CLI targets whose global install dirs we know. Detection is
// presence-based (config dir exists); we never write into CLI dirs directly —
// CLI installs always surface the canonical `npx skills add` command.
const CLI_TARGET_DEFS = Object.freeze([
  { id: "claude", label: "Claude Code", detectPath: () => path.join(os.homedir(), ".claude") },
  { id: "codex", label: "OpenAI Codex", detectPath: () => path.join(os.homedir(), ".codex") },
  { id: "opencode", label: "OpenCode", detectPath: () => path.join(os.homedir(), ".config", "opencode") },
  { id: "cursor", label: "Cursor", detectPath: () => path.join(os.homedir(), ".cursor") },
]);

export function listCliTargetDefs() {
  return CLI_TARGET_DEFS.map((d) => ({ id: d.id, label: d.label }));
}

/**
 * Detect which CLI targets are present. `fsImpl` is injectable for tests.
 * Never throws — a detection error simply marks the target unavailable.
 */
export function detectCliTargets(fsImpl = null) {
  const fsx = fsImpl || fs;
  return CLI_TARGET_DEFS.map((def) => {
    let available = false;
    try {
      available = fsx.existsSync(def.detectPath());
    } catch {
      available = false;
    }
    return {
      id: def.id,
      label: def.label,
      available,
      // Global install for a CLI always goes through the canonical installer.
      command: "npx skills add",
    };
  });
}

export function getTargetLabel(id) {
  if (id === DARDCOR CODE_TARGET) return "Dardcor Code global registry";
  const def = CLI_TARGET_DEFS.find((d) => d.id === id);
  return def ? def.label : null;
}

export function isKnownTarget(id) {
  return id === DARDCOR CODE_TARGET || id === "cli" || id === "both" || CLI_TARGET_DEFS.some((d) => d.id === id);
}

export function isKnownCliTarget(id) {
  return CLI_TARGET_DEFS.some((d) => d.id === id);
}

/**
 * Canonical install command for a skill on a target. Always a manual command —
 * the server never executes shells. For remote skills it is `npx skills add`.
 */
export function getInstallCommand(skill, target) {
  if (!skill) return "";
  if (target === DARDCOR CODE_TARGET) return "";
  // Local built-in skills are not published npm/GitHub packages — never
  // fabricate an `npx skills add` URL for them.
  if (skill.source === "dardcor-code") return "";
  return skill.installCommand || (skill.sourceRef ? `npx skills add ${skill.sourceRef} --skill ${skill.slug}` : "");
}

export const __test__ = { detectCliTargets, getInstallCommand, isKnownTarget, isKnownCliTarget, getTargetLabel };

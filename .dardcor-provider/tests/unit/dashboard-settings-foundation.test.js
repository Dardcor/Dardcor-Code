import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FEATURE_FLAGS, GUARDRAILS } from "../../src/lib/settings/dashboardSettings.js";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dardcor-code-dashboard-settings-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("dashboard settings foundation", () => {
  it("persists every exposed feature flag through settings storage", async () => {
    const { getSettings, updateSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const initial = await getSettings();

    for (const flag of FEATURE_FLAGS) {
      expect(typeof initial[flag.key]).toBe("boolean");
    }

    const enabled = Object.fromEntries(FEATURE_FLAGS.map((flag) => [flag.key, true]));
    await updateSettings(enabled);
    const persisted = await getSettings();

    for (const flag of FEATURE_FLAGS) {
      expect(persisted[flag.key]).toBe(true);
    }
  });

  it("describes only implemented configurable or enforced guardrails", () => {
    expect(GUARDRAILS.length).toBeGreaterThan(0);
    for (const guardrail of GUARDRAILS) {
      expect(Boolean(guardrail.settingKey) || guardrail.enforced === true).toBe(true);
    }

    const claims = JSON.stringify(GUARDRAILS).toLowerCase();
    expect(claims).not.toContain("prompt injection");
    expect(claims).not.toContain("personally identifiable");
  });
});

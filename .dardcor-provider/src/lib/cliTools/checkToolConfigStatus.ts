// DRY: shared between /api/cli-tools/status and /api/cli-tools/all-statuses (plan 14 F2)

import fs from "fs/promises";
import { getCliPrimaryConfigPath } from "@/shared/services/cliRuntime";
import { hasDardcorCodeQwenCodeConfig } from "@/shared/services/qwenCodeConfig";
import { getRuntimePorts } from "@/lib/runtime/ports";

const { apiPort } = getRuntimePorts();

/**
 * Check if a tool has DardcorCode configured by reading its config file directly.
 * This replaces the expensive self-referential HTTP calls to /api/cli-tools/*-settings.
 *
 * @param toolId - CLI tool identifier (e.g. "claude", "codex", "cline")
 * @param _configPathOverride - optional path override (used in tests for DI)
 *
 * Returns: "configured" | "not_configured" | "not_installed" | "unknown" | "other"
 */
export async function checkToolConfigStatus(
  toolId: string,
  _configPathOverride?: string
): Promise<"configured" | "not_configured" | "not_installed" | "unknown" | "other"> {
  try {
    const configPath = _configPathOverride ?? getCliPrimaryConfigPath(toolId);
    if (!configPath) return "unknown";

    const content = await fs.readFile(configPath, "utf-8");

    // Codex uses TOML config — parse as raw text, not JSON
    if (toolId === "codex") {
      const lower = content.toLowerCase();
      const hasDardcorCode =
        lower.includes("dardcorCode") ||
        lower.includes(`localhost:${apiPort}`) ||
        lower.includes(`127.0.0.1:${apiPort}`);
      if (!hasDardcorCode) return "not_configured";

      // Also verify auth.json has an API key (not masked/empty)
      try {
        const authPath = configPath.replace(/config\.toml$/, "auth.json");
        const authContent = await fs.readFile(authPath, "utf-8");
        const auth = JSON.parse(authContent) as Record<string, unknown>;
        const apiKey = (auth?.OPENAI_API_KEY as string) || "";
        if (!apiKey || apiKey.includes("****") || apiKey.length < 20) {
          return "not_configured";
        }
      } catch {
        return "not_configured";
      }

      return "configured";
    }

    if (toolId === "hermes") {
      const lower = content.toLowerCase();
      const hasDardcorCode =
        lower.includes("dardcorCode") ||
        lower.includes(`localhost:${apiPort}`) ||
        lower.includes(`127.0.0.1:${apiPort}`);
      return hasDardcorCode ? "configured" : "not_configured";
    }

    const config = JSON.parse(content) as Record<string, unknown>;

    // Each tool stores DardcorCode config differently
    switch (toolId) {
      case "claude":
        return (config?.env as Record<string, unknown>)?.ANTHROPIC_BASE_URL
          ? "configured"
          : "not_configured";
      case "qwen":
        return hasDardcorCodeQwenCodeConfig(config) ? "configured" : "not_configured";
      case "droid":
      case "openclaw":
      case "cline":
      case "kilo": {
        // Generic check: look for DardcorCode-specific markers in the config
        const configStr = JSON.stringify(config).toLowerCase();
        if (
          configStr.includes("dardcorCode") ||
          configStr.includes("sk_dardcorCode") ||
          configStr.includes(`localhost:${apiPort}`) ||
          configStr.includes(`127.0.0.1:${apiPort}`)
        ) {
          return "configured";
        }
        // Also accept openai-compatible provider with any non-empty baseUrl
        // (user may configure an external domain instead of localhost)
        if (
          toolId === "cline" &&
          ((config.actModeApiProvider === "openai" || config.planModeApiProvider === "openai") &&
            ((config.openAiBaseUrl as string) || "").trim().length > 0)
        ) {
          return "configured";
        }
        return "not_configured";
      }
      default:
        return "unknown";
    }
  } catch {
    return "not_configured";
  }
}

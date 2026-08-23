import { GET as claude } from "@/app/api/cli-tools/claude-settings/route";
import { GET as codex } from "@/app/api/cli-tools/codex-settings/route";
import { GET as opencode } from "@/app/api/cli-tools/opencode-settings/route";
import { GET as droid } from "@/app/api/cli-tools/droid-settings/route";
import { GET as openclaw } from "@/app/api/cli-tools/openclaw-settings/route";
import { GET as hermes } from "@/app/api/cli-tools/hermes-settings/route";
import { GET as cowork } from "@/app/api/cli-tools/cowork-settings/route";
import { GET as copilot } from "@/app/api/cli-tools/copilot-settings/route";
import { GET as cline } from "@/app/api/cli-tools/cline-settings/route";
import { GET as kilo } from "@/app/api/cli-tools/kilo-settings/route";
import { GET as deepseekTui } from "@/app/api/cli-tools/deepseek-tui-settings/route";
import { GET as jcode } from "@/app/api/cli-tools/jcode-settings/route";
import { GET as grokBuild } from "@/app/api/cli-tools/grok-build-settings/route";
import { GET as devin } from "@/app/api/cli-tools/devin-settings/route";

const getters = { claude, codex, opencode, droid, openclaw, hermes, cowork, copilot, cline, kilo, "deepseek-tui": deepseekTui, jcode, "grok-build": grokBuild, devin };

export const agentStatusChecks = Object.fromEntries(Object.entries(getters).map(([id, getter]) => [id, async () => {
  const response = await getter();
  const data = await response.json();
  if (!response.ok || data?.error) throw new Error("Status check failed");
  return data;
}]));

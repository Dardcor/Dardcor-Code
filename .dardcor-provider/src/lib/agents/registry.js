import { getAgentLifecycle, recordAgentLifecycle } from "./lifecycle.js";

const AGENTS = [
  ["claude", "Claude Code", "cli", true],
  ["codex", "OpenAI Codex", "cli", true],
  ["opencode", "OpenCode", "cli", true],
  ["droid", "Factory Droid", "cli", true],
  ["openclaw", "OpenClaw", "cli", true],
  ["hermes", "Hermes Agent", "cli", true],
  ["cowork", "Claude Desktop", "desktop", true],
  ["copilot", "GitHub Copilot", "desktop", true],
  ["cline", "Cline", "desktop", true],
  ["kilo", "Kilo Code", "desktop", true],
  ["deepseek-tui", "DeepSeek TUI", "cli", true],
  ["jcode", "JCode", "cli", true],
  ["grok-build", "Grok Build", "cloud-cli", true],
  ["devin", "Devin CLI", "cloud-cli", false],
].map(([id, name, kind, configure]) => Object.freeze({
  id,
  name,
  kind,
  capabilities: Object.freeze({ status: true, configure, launch: false, adopt: false }),
}));

const ERROR_STATUS = Object.freeze({
  state: "error",
  available: false,
  configured: false,
  running: false,
  error: "Status check failed",
});

export function normalizeAgentStatus(result) {
  if (!result || result.error) return { ...ERROR_STATUS };
  const running = result.running === true;
  const configured = result.configured === true || result.has9Router === true;
  const available = result.installed === true || configured || running;
  const state = running ? "running" : configured ? "configured" : available ? "available" : "unavailable";
  return { state, available, configured, running, error: null };
}

export function createAgentRegistry(statusChecks = {}) {
  const definitions = new Map(AGENTS.map((agent) => [agent.id, agent]));

  return {
    async list() {
      return Promise.all(AGENTS.map(async (agent) => {
        const check = statusChecks[agent.id];
        if (!check) return { ...agent, status: { ...ERROR_STATUS } };
        try {
          return { ...agent, status: normalizeAgentStatus(await check()) };
        } catch {
          return { ...agent, status: { ...ERROR_STATUS } };
        }
      }));
    },

    async performAction(agentId, action) {
      if (!definitions.has(agentId)) return { ok: false, code: "agent_not_found", error: "Agent integration not found" };
      const label = action === "adopt" ? "Adoption" : "Launch";
      const result = { ok: false, code: "unsupported_action", error: `${label} is not supported for this integration` };
      recordAgentLifecycle({ agentId, action, status: "unsupported", error: result.error });
      return result;
    },

    lifecycle: getAgentLifecycle,
  };
}

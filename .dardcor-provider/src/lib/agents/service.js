import { createAgentRegistry } from "./registry.js";
import { getAgentLifecycle } from "./lifecycle.js";
import { agentStatusChecks } from "./statusChecks.js";

export const agentRegistry = createAgentRegistry(agentStatusChecks);
export const getAgentRegistryLifecycle = getAgentLifecycle;

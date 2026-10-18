
import type { InternalSessionSource } from "./InternalSessionSource.js";
import type { SubAgentSource } from "./SubAgentSource.js";

export type SessionSource = "cli" | "vscode" | "exec" | "mcp" | { "custom": string } | { "internal": InternalSessionSource } | { "subagent": SubAgentSource } | "unknown";

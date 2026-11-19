
import type { JsonValue } from "../serde_json/JsonValue.js";

export type ConfiguredHookHandler = {
	"type": "command", command: string, commandWindows: string | null, timeoutSec: bigint | null, async: boolean, statusMessage: string | null,
	additionalContextLimit: number | null,
} | { "type": "mcp_tool", server: string, tool: string, input: { [key in string]?: JsonValue }, timeoutSec: bigint | null, statusMessage: string | null, } | { "type": "prompt", } | { "type": "agent", };

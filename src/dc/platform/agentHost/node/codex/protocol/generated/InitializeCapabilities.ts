
import type { JsonValue } from "./serde_json/JsonValue.js";

export type InitializeCapabilities = {
	experimentalApi: boolean,
	requestAttestation: boolean,
	mcpServerOpenaiFormElicitation?: boolean,
	optOutNotificationMethods?: Array<string> | null,
	extensions?: { [key in string]?: JsonValue } | null,
};


import type { AdditionalContextEntry } from "./AdditionalContextEntry.js";
import type { UserInput } from "./UserInput.js";

export type TurnSteerParams = {
	threadId: string, clientUserMessageId?: string | null, input: Array<UserInput>,
	responsesapiClientMetadata?: { [key in string]?: string } | null,
	additionalContext?: { [key in string]?: AdditionalContextEntry } | null,
	expectedTurnId: string,
};

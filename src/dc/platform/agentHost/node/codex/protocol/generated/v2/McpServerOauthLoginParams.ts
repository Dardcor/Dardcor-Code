
import type { McpServerOauthClientRegistration } from "./McpServerOauthClientRegistration.js";

export type McpServerOauthLoginParams = {
	name: string, threadId?: string | null,
	clientRegistration?: McpServerOauthClientRegistration | null, scopes?: Array<string> | null, timeoutSecs?: bigint | null,
};

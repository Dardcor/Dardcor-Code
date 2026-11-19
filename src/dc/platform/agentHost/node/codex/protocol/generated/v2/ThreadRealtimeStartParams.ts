
import type { CodexResponseHandoffMode } from "../CodexResponseHandoffMode.js";
import type { RealtimeConversationVersion } from "../RealtimeConversationVersion.js";
import type { RealtimeOutputModality } from "../RealtimeOutputModality.js";
import type { RealtimeVoice } from "../RealtimeVoice.js";
import type { ThreadRealtimeInitialItem } from "./ThreadRealtimeInitialItem.js";
import type { ThreadRealtimeStartTransport } from "./ThreadRealtimeStartTransport.js";

export type ThreadRealtimeStartParams = {
	threadId: string,
	clientManagedHandoffs?: boolean | null,
	delegationAckFiller?: boolean | null,
	flushTranscriptTailOnSessionEnd?: boolean | null,
	codexResponsesAsItems?: boolean | null,
	codexResponseItemPrefix?: string | null,
	codexResponseHandoffMode?: CodexResponseHandoffMode | null,
	codexResponseHandoffChannelPrefixes?: { [key in string]?: Array<string> } | null,
	model?: string | null,
	outputModality: RealtimeOutputModality,
	includeStartupContext?: boolean | null,
	initialItems?: Array<ThreadRealtimeInitialItem> | null,
	realtimeStartInstructions?: string | null,
	realtimeEndInstructions?: string | null, prompt?: string | null | null, realtimeSessionId?: string | null, transport?: ThreadRealtimeStartTransport | null,
	version?: RealtimeConversationVersion | null, voice?: RealtimeVoice | null,
};

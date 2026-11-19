
import type { ThreadId } from "./ThreadId.js";

export type GetConversationSummaryParams = { rolloutPath: string, } | { conversationId: ThreadId, };

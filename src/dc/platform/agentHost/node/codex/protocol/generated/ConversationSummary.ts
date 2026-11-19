
import type { ConversationGitInfo } from "./ConversationGitInfo.js";
import type { SessionSource } from "./SessionSource.js";
import type { ThreadId } from "./ThreadId.js";

export type ConversationSummary = { conversationId: ThreadId, path: string, preview: string, timestamp: string | null, updatedAt: string | null, modelProvider: string, cwd: string, cliVersion: string, source: SessionSource, gitInfo: ConversationGitInfo | null, };

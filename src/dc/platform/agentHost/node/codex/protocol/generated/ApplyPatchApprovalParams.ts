
import type { FileChange } from "./FileChange.js";
import type { ThreadId } from "./ThreadId.js";

export type ApplyPatchApprovalParams = {
	conversationId: ThreadId,
	callId: string, fileChanges: { [key in string]?: FileChange },
	reason: string | null,
	grantRoot: string | null,
};

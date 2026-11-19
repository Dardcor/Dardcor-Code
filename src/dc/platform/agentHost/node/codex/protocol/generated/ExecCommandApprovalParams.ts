
import type { ParsedCommand } from "./ParsedCommand.js";
import type { ThreadId } from "./ThreadId.js";

export type ExecCommandApprovalParams = {
	conversationId: ThreadId,
	callId: string,
	approvalId: string | null, command: Array<string>, cwd: string, reason: string | null, parsedCmd: Array<ParsedCommand>,
};

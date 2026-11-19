
import type { CollaborationMode } from "../CollaborationMode.js";
import type { MultiAgentMode } from "../MultiAgentMode.js";
import type { Personality } from "../Personality.js";
import type { ReasoningEffort } from "../ReasoningEffort.js";
import type { ReasoningSummary } from "../ReasoningSummary.js";
import type { ApprovalsReviewer } from "./ApprovalsReviewer.js";
import type { AskForApproval } from "./AskForApproval.js";
import type { SandboxPolicy } from "./SandboxPolicy.js";

export type ThreadSettingsUpdateParams = {
	threadId: string,
	cwd?: string | null,
	approvalPolicy?: AskForApproval | null,
	approvalsReviewer?: ApprovalsReviewer | null,
	sandboxPolicy?: SandboxPolicy | null,
	permissions?: string | null,
	model?: string | null,
	serviceTier?: string | null | null,
	effort?: ReasoningEffort | null,
	summary?: ReasoningSummary | null,
	collaborationMode?: CollaborationMode | null,
	multiAgentMode?: MultiAgentMode | null,
	personality?: Personality | null,
};

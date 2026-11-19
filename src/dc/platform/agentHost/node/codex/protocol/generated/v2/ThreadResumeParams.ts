
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";
import type { Personality } from "../Personality.js";
import type { ResponseItem } from "../ResponseItem.js";
import type { JsonValue } from "../serde_json/JsonValue.js";
import type { ApprovalsReviewer } from "./ApprovalsReviewer.js";
import type { AskForApproval } from "./AskForApproval.js";
import type { SandboxMode } from "./SandboxMode.js";
import type { ThreadResumeInitialTurnsPageParams } from "./ThreadResumeInitialTurnsPageParams.js";

export type ThreadResumeParams = {
	threadId: string,
	history?: Array<ResponseItem> | null,
	path?: string | null,
	model?: string | null, modelProvider?: string | null, serviceTier?: string | null | null, cwd?: string | null,
	runtimeWorkspaceRoots?: Array<AbsolutePathBuf> | null, approvalPolicy?: AskForApproval | null,
	approvalsReviewer?: ApprovalsReviewer | null, sandbox?: SandboxMode | null,
	permissions?: string | null, config?: { [key in string]?: JsonValue } | null, baseInstructions?: string | null, developerInstructions?: string | null, personality?: Personality | null,
	excludeTurns?: boolean,
	initialTurnsPage?: ThreadResumeInitialTurnsPageParams | null,
};

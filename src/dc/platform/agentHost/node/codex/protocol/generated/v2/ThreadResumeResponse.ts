
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";
import type { LegacyAppPathString } from "../LegacyAppPathString.js";
import type { MultiAgentMode } from "../MultiAgentMode.js";
import type { ReasoningEffort } from "../ReasoningEffort.js";
import type { ActivePermissionProfile } from "./ActivePermissionProfile.js";
import type { ApprovalsReviewer } from "./ApprovalsReviewer.js";
import type { AskForApproval } from "./AskForApproval.js";
import type { SandboxPolicy } from "./SandboxPolicy.js";
import type { Thread } from "./Thread.js";
import type { TurnsPage } from "./TurnsPage.js";

export type ThreadResumeResponse = {
	thread: Thread, model: string, modelProvider: string, serviceTier: string | null, cwd: AbsolutePathBuf,
	runtimeWorkspaceRoots: Array<AbsolutePathBuf>,
	instructionSources: Array<LegacyAppPathString>, approvalPolicy: AskForApproval,
	approvalsReviewer: ApprovalsReviewer,
	sandbox: SandboxPolicy,
	activePermissionProfile: ActivePermissionProfile | null, reasoningEffort: ReasoningEffort | null,
	multiAgentMode: MultiAgentMode,
	initialTurnsPage: TurnsPage | null,
	turnsBackwardsCursor: string | null,
	itemsBackwardsCursor: string | null,
};

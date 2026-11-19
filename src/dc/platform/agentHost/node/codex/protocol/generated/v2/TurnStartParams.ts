
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";
import type { CollaborationMode } from "../CollaborationMode.js";
import type { MultiAgentMode } from "../MultiAgentMode.js";
import type { Personality } from "../Personality.js";
import type { ReasoningEffort } from "../ReasoningEffort.js";
import type { ReasoningSummary } from "../ReasoningSummary.js";
import type { JsonValue } from "../serde_json/JsonValue.js";
import type { AdditionalContextEntry } from "./AdditionalContextEntry.js";
import type { ApprovalsReviewer } from "./ApprovalsReviewer.js";
import type { AskForApproval } from "./AskForApproval.js";
import type { SandboxPolicy } from "./SandboxPolicy.js";
import type { TurnEnvironmentParams } from "./TurnEnvironmentParams.js";
import type { UserInput } from "./UserInput.js";

export type TurnStartParams = {
	threadId: string, clientUserMessageId?: string | null, input: Array<UserInput>,
	responsesapiClientMetadata?: { [key in string]?: string } | null,
	additionalContext?: { [key in string]?: AdditionalContextEntry } | null,
	environments?: Array<TurnEnvironmentParams> | null,
	cwd?: string | null,
	runtimeWorkspaceRoots?: Array<AbsolutePathBuf> | null,
	approvalPolicy?: AskForApproval | null,
	approvalsReviewer?: ApprovalsReviewer | null,
	sandboxPolicy?: SandboxPolicy | null,
	permissions?: string | null,
	model?: string | null,
	serviceTier?: string | null | null,
	effort?: ReasoningEffort | null,
	summary?: ReasoningSummary | null,
	personality?: Personality | null,
	outputSchema?: JsonValue | null,
	collaborationMode?: CollaborationMode | null,
	multiAgentMode?: MultiAgentMode | null,
};

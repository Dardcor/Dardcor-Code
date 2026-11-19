
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";
import type { MultiAgentMode } from "../MultiAgentMode.js";
import type { Personality } from "../Personality.js";
import type { JsonValue } from "../serde_json/JsonValue.js";
import type { ApprovalsReviewer } from "./ApprovalsReviewer.js";
import type { AskForApproval } from "./AskForApproval.js";
import type { DynamicToolSpec } from "./DynamicToolSpec.js";
import type { SandboxMode } from "./SandboxMode.js";
import type { SelectedCapabilityRoot } from "./SelectedCapabilityRoot.js";
import type { ThreadHistoryMode } from "./ThreadHistoryMode.js";
import type { ThreadSource } from "./ThreadSource.js";
import type { ThreadStartSource } from "./ThreadStartSource.js";
import type { TurnEnvironmentParams } from "./TurnEnvironmentParams.js";

export type ThreadStartParams = {
	model?: string | null, modelProvider?: string | null,
	allowProviderModelFallback?: boolean, serviceTier?: string | null | null, cwd?: string | null,
	runtimeWorkspaceRoots?: Array<AbsolutePathBuf> | null, approvalPolicy?: AskForApproval | null,
	approvalsReviewer?: ApprovalsReviewer | null, sandbox?: SandboxMode | null,
	permissions?: string | null, config?: { [key in string]?: JsonValue } | null, serviceName?: string | null, baseInstructions?: string | null, developerInstructions?: string | null, personality?: Personality | null,
	multiAgentMode?: MultiAgentMode | null, ephemeral?: boolean | null,
	historyMode?: ThreadHistoryMode | null, sessionStartSource?: ThreadStartSource | null,
	threadSource?: ThreadSource | null,
	projectId?: string | null,
	environments?: Array<TurnEnvironmentParams> | null, dynamicTools?: Array<DynamicToolSpec> | null,
	selectedCapabilityRoots?: Array<SelectedCapabilityRoot> | null,
	mockExperimentalField?: string | null,
	experimentalRawEvents?: boolean,
};

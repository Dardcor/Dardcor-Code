
import type { LegacyAppPathString } from "../LegacyAppPathString.js";
import type { AdditionalPermissionProfile } from "./AdditionalPermissionProfile.js";
import type { CommandAction } from "./CommandAction.js";
import type { CommandExecutionApprovalDecision } from "./CommandExecutionApprovalDecision.js";
import type { ExecPolicyAmendment } from "./ExecPolicyAmendment.js";
import type { NetworkApprovalContext } from "./NetworkApprovalContext.js";
import type { NetworkPolicyAmendment } from "./NetworkPolicyAmendment.js";

export type CommandExecutionRequestApprovalParams = {
	threadId: string, turnId: string, itemId: string,
	startedAtMs: number,
	approvalId?: string | null,
	environmentId: string | null,
	reason?: string | null,
	networkApprovalContext?: NetworkApprovalContext | null,
	command?: string | null,
	cwd?: LegacyAppPathString | null,
	commandActions?: Array<CommandAction> | null,
	additionalPermissions?: AdditionalPermissionProfile | null,
	proposedExecpolicyAmendment?: ExecPolicyAmendment | null,
	proposedNetworkPolicyAmendments?: Array<NetworkPolicyAmendment> | null,
	availableDecisions?: Array<CommandExecutionApprovalDecision> | null,
};

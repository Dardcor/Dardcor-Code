
import type { AbsolutePathBuf } from "../AbsolutePathBuf.js";
import type { RequestPermissionProfile } from "./RequestPermissionProfile.js";

export type PermissionsRequestApprovalParams = {
	threadId: string, turnId: string, itemId: string, environmentId: string | null,
	startedAtMs: number, cwd: AbsolutePathBuf, reason: string | null, permissions: RequestPermissionProfile,
};

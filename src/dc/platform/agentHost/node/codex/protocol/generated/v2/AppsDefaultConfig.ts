
import type { AppToolApproval } from "./AppToolApproval.js";
import type { ApprovalsReviewer } from "./ApprovalsReviewer.js";

export type AppsDefaultConfig = { enabled: boolean, approvals_reviewer: ApprovalsReviewer | null, destructive_enabled: boolean, open_world_enabled: boolean, default_tools_approval_mode: AppToolApproval | null, };

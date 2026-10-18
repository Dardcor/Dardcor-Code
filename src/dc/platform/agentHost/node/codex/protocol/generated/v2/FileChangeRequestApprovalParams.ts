
export type FileChangeRequestApprovalParams = {
	threadId: string, turnId: string, itemId: string,
	startedAtMs: number,
	reason?: string | null,
	grantRoot?: string | null,
};

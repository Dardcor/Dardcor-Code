
import type { ThreadMetadataGitInfoUpdateParams } from "./ThreadMetadataGitInfoUpdateParams.js";

export type ThreadMetadataUpdateParams = {
	threadId: string,
	projectId?: string | null,
	gitInfo?: ThreadMetadataGitInfoUpdateParams | null,
};

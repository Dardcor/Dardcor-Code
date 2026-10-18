
import type { WorkspaceMessage } from "./WorkspaceMessage.js";

export type GetWorkspaceMessagesResponse = {
	featureEnabled: boolean,
	messages: Array<WorkspaceMessage>,
};


import type { WorkspaceMessageType } from "./WorkspaceMessageType.js";

export type WorkspaceMessage = {
	messageId: string, messageType: WorkspaceMessageType, messageBody: string,
	createdAt: number | null,
	archivedAt: number | null,
};

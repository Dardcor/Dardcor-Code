
import type { McpServerStatusDetail } from "./McpServerStatusDetail.js";

export type ListMcpServerStatusParams = {
	cursor?: string | null,
	limit?: number | null,
	detail?: McpServerStatusDetail | null, threadId?: string | null,
};

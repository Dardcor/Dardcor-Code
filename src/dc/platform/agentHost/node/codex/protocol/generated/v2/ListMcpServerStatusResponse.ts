
import type { McpServerStatus } from "./McpServerStatus.js";

export type ListMcpServerStatusResponse = {
	data: Array<McpServerStatus>,
	nextCursor: string | null,
};

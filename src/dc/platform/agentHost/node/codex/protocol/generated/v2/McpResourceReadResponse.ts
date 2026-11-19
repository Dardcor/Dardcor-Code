
import type { ResourceContent } from "../ResourceContent.js";

export type McpResourceReadResponse = {
	contents: Array<ResourceContent>,
	originCallId: string | null,
};

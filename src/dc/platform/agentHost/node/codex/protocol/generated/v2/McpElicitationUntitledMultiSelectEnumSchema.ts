
import type { McpElicitationArrayType } from "./McpElicitationArrayType.js";
import type { McpElicitationUntitledEnumItems } from "./McpElicitationUntitledEnumItems.js";

export type McpElicitationUntitledMultiSelectEnumSchema = { type: McpElicitationArrayType, title?: string, description?: string, minItems?: bigint, maxItems?: bigint, items: McpElicitationUntitledEnumItems, default?: Array<string>, };

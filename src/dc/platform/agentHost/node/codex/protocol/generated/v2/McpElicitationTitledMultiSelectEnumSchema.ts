
import type { McpElicitationArrayType } from "./McpElicitationArrayType.js";
import type { McpElicitationTitledEnumItems } from "./McpElicitationTitledEnumItems.js";

export type McpElicitationTitledMultiSelectEnumSchema = { type: McpElicitationArrayType, title?: string, description?: string, minItems?: bigint, maxItems?: bigint, items: McpElicitationTitledEnumItems, default?: Array<string>, };

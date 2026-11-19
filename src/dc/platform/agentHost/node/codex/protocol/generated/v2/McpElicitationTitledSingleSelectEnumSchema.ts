
import type { McpElicitationConstOption } from "./McpElicitationConstOption.js";
import type { McpElicitationStringType } from "./McpElicitationStringType.js";

export type McpElicitationTitledSingleSelectEnumSchema = { type: McpElicitationStringType, title?: string, description?: string, oneOf: Array<McpElicitationConstOption>, default?: string, };

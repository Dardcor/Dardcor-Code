
import type { McpElicitationStringFormat } from "./McpElicitationStringFormat.js";
import type { McpElicitationStringType } from "./McpElicitationStringType.js";

export type McpElicitationStringSchema = { type: McpElicitationStringType, title?: string, description?: string, minLength?: number, maxLength?: number, format?: McpElicitationStringFormat, default?: string, };

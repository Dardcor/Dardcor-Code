
import type { McpElicitationObjectType } from "./McpElicitationObjectType.js";
import type { McpElicitationPrimitiveSchema } from "./McpElicitationPrimitiveSchema.js";

export type McpElicitationSchema = { $schema?: string, type: McpElicitationObjectType, properties: { [key in string]?: McpElicitationPrimitiveSchema }, required?: Array<string>, };

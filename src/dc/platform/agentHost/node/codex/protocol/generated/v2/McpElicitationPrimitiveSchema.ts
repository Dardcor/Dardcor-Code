
import type { McpElicitationBooleanSchema } from "./McpElicitationBooleanSchema.js";
import type { McpElicitationEnumSchema } from "./McpElicitationEnumSchema.js";
import type { McpElicitationNumberSchema } from "./McpElicitationNumberSchema.js";
import type { McpElicitationStringSchema } from "./McpElicitationStringSchema.js";

export type McpElicitationPrimitiveSchema = McpElicitationEnumSchema | McpElicitationStringSchema | McpElicitationNumberSchema | McpElicitationBooleanSchema;

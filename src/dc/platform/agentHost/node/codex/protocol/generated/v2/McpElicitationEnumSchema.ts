
import type { McpElicitationLegacyTitledEnumSchema } from "./McpElicitationLegacyTitledEnumSchema.js";
import type { McpElicitationMultiSelectEnumSchema } from "./McpElicitationMultiSelectEnumSchema.js";
import type { McpElicitationSingleSelectEnumSchema } from "./McpElicitationSingleSelectEnumSchema.js";

export type McpElicitationEnumSchema = McpElicitationSingleSelectEnumSchema | McpElicitationMultiSelectEnumSchema | McpElicitationLegacyTitledEnumSchema;

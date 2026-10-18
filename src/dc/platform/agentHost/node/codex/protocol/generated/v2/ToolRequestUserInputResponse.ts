
import type { ToolRequestUserInputAnswer } from "./ToolRequestUserInputAnswer.js";

export type ToolRequestUserInputResponse = { answers: { [key in string]?: ToolRequestUserInputAnswer }, };

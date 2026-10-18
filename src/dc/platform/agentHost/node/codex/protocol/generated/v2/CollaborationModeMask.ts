
import type { ModeKind } from "../ModeKind.js";
import type { ReasoningEffort } from "../ReasoningEffort.js";

export type CollaborationModeMask = { name: string, mode: ModeKind | null, model: string | null, reasoning_effort: ReasoningEffort | null | null, };

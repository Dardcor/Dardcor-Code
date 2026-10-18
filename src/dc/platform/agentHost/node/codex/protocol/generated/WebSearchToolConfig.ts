
import type { WebSearchContextSize } from "./WebSearchContextSize.js";
import type { WebSearchLocation } from "./WebSearchLocation.js";

export type WebSearchToolConfig = { context_size: WebSearchContextSize | null, allowed_domains: Array<string> | null, location: WebSearchLocation | null, };


import type { AppToolSummary } from "./AppToolSummary.js";

export type ConnectorMetadata = { id: string, name: string, description: string | null, iconUrl: string | null, iconUrlDark: string | null, distributionChannel: string | null, installUrl: string | null, pluginDisplayNames: Array<string>, toolSummaries: Array<AppToolSummary> | null, };

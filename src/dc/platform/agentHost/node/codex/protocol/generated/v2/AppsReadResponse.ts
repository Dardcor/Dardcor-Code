
import type { ConnectorMetadata } from "./ConnectorMetadata.js";

export type AppsReadResponse = { apps: Array<ConnectorMetadata>, missingAppIds: Array<string>, };

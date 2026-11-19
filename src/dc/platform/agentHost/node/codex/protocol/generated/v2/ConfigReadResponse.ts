
import type { Config } from "./Config.js";
import type { ConfigLayer } from "./ConfigLayer.js";
import type { ConfigLayerMetadata } from "./ConfigLayerMetadata.js";

export type ConfigReadResponse = { config: Config, origins: { [key in string]?: ConfigLayerMetadata }, layers: Array<ConfigLayer> | null, };

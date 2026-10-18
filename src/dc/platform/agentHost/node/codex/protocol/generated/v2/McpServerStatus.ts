
import type { McpServerInfo } from "../McpServerInfo.js";
import type { Resource } from "../Resource.js";
import type { ResourceTemplate } from "../ResourceTemplate.js";
import type { Tool } from "../Tool.js";
import type { McpAuthStatus } from "./McpAuthStatus.js";

export type McpServerStatus = { name: string, pluginId: string | null, serverInfo: McpServerInfo | null, tools: { [key in string]?: Tool }, resources: Array<Resource>, resourceTemplates: Array<ResourceTemplate>, authStatus: McpAuthStatus, };

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MCP } from './modelContextProtocol.js';

type CallToolResult = MCP.CallToolResult;
type ContentBlock = MCP.ContentBlock;
type Implementation = MCP.Implementation;
type RequestId = MCP.RequestId;
type Tool = MCP.Tool;

export namespace McpApps {
	export type AppRequest =
		| MCP.CallToolRequest
		| MCP.ReadResourceRequest
		| MCP.CreateMessageRequest
		| MCP.PingRequest
		| (McpUiOpenLinkRequest & MCP.JSONRPCRequest)
		| (McpUiDownloadFileRequest & MCP.JSONRPCRequest)
		| (McpUiUpdateModelContextRequest & MCP.JSONRPCRequest)
		| (McpUiMessageRequest & MCP.JSONRPCRequest)
		| (McpUiRequestDisplayModeRequest & MCP.JSONRPCRequest)
		| (McpApps.McpUiInitializeRequest & MCP.JSONRPCRequest);

	export type AppNotification =
		| McpUiInitializedNotification
		| McpUiSizeChangedNotification
		| MCP.LoggingMessageNotification
		| CustomSandboxWheelNotification;

	export type AppMessage = AppRequest | AppNotification;

	export type HostResult =
		| MCP.CallToolResult
		| MCP.ReadResourceResult
		| MCP.CreateMessageResult
		| MCP.EmptyResult
		| McpApps.McpUiInitializeResult
		| McpUiMessageResult
		| McpUiOpenLinkResult
		| McpUiDownloadFileResult
		| McpUiRequestDisplayModeResult;

	export type HostNotification =
		| McpUiHostContextChangedNotification
		| McpUiResourceTeardownRequest
		| McpUiToolInputNotification
		| McpUiToolInputPartialNotification
		| McpUiToolResultNotification
		| McpUiToolCancelledNotification
		| McpUiSizeChangedNotification;

	export type HostMessage = HostResult | HostNotification;


	export interface CustomSandboxWheelNotification {
		method: 'ui/notifications/sandbox-wheel';
		params: {
			deltaMode: number;
			deltaX: number;
			deltaY: number;
			deltaZ: number;
		};
	}
}

/* eslint-disable local/code-no-unexternalized-strings */


export namespace McpApps {
	export const LATEST_PROTOCOL_VERSION = "2026-01-26";

	export type McpUiTheme = "light" | "dark";

	export type McpUiDisplayMode = "inline" | "fullscreen" | "pip";

	export type McpUiStyleVariableKey =
		| "--color-background-primary"
		| "--color-background-secondary"
		| "--color-background-tertiary"
		| "--color-background-inverse"
		| "--color-background-ghost"
		| "--color-background-info"
		| "--color-background-danger"
		| "--color-background-success"
		| "--color-background-warning"
		| "--color-background-disabled"
		| "--color-text-primary"
		| "--color-text-secondary"
		| "--color-text-tertiary"
		| "--color-text-inverse"
		| "--color-text-ghost"
		| "--color-text-info"
		| "--color-text-danger"
		| "--color-text-success"
		| "--color-text-warning"
		| "--color-text-disabled"
		| "--color-text-ghost"
		| "--color-border-primary"
		| "--color-border-secondary"
		| "--color-border-tertiary"
		| "--color-border-inverse"
		| "--color-border-ghost"
		| "--color-border-info"
		| "--color-border-danger"
		| "--color-border-success"
		| "--color-border-warning"
		| "--color-border-disabled"
		| "--color-ring-primary"
		| "--color-ring-secondary"
		| "--color-ring-inverse"
		| "--color-ring-info"
		| "--color-ring-danger"
		| "--color-ring-success"
		| "--color-ring-warning"
		| "--font-sans"
		| "--font-mono"
		| "--font-weight-normal"
		| "--font-weight-medium"
		| "--font-weight-semibold"
		| "--font-weight-bold"
		| "--font-text-xs-size"
		| "--font-text-sm-size"
		| "--font-text-md-size"
		| "--font-text-lg-size"
		| "--font-heading-xs-size"
		| "--font-heading-sm-size"
		| "--font-heading-md-size"
		| "--font-heading-lg-size"
		| "--font-heading-xl-size"
		| "--font-heading-2xl-size"
		| "--font-heading-3xl-size"
		| "--font-text-xs-line-height"
		| "--font-text-sm-line-height"
		| "--font-text-md-line-height"
		| "--font-text-lg-line-height"
		| "--font-heading-xs-line-height"
		| "--font-heading-sm-line-height"
		| "--font-heading-md-line-height"
		| "--font-heading-lg-line-height"
		| "--font-heading-xl-line-height"
		| "--font-heading-2xl-line-height"
		| "--font-heading-3xl-line-height"
		| "--border-radius-xs"
		| "--border-radius-sm"
		| "--border-radius-md"
		| "--border-radius-lg"
		| "--border-radius-xl"
		| "--border-radius-full"
		| "--border-width-regular"
		| "--shadow-hairline"
		| "--shadow-sm"
		| "--shadow-md"
		| "--shadow-lg";

	export type McpUiStyles = Record<McpUiStyleVariableKey, string | undefined>;

	export interface McpUiOpenLinkRequest {
		method: "ui/open-link";
		params: {
			url: string;
		};
	}

	export interface McpUiOpenLinkResult {
		isError?: boolean;
		[key: string]: unknown;
	}

	export interface McpUiDownloadFileRequest {
		method: "ui/download-file";
		params: {
			contents: (MCP.EmbeddedResource | MCP.ResourceLink)[];
		};
	}

	export interface McpUiDownloadFileResult {
		isError?: boolean;
		[key: string]: unknown;
	}

	export interface McpUiMessageRequest {
		method: "ui/message";
		params: {
			role: "user";
			content: ContentBlock[];
		};
	}

	export interface McpUiMessageResult {
		isError?: boolean;
		[key: string]: unknown;
	}

	/**
	 * @description Notification that the sandbox proxy iframe is ready to receive content.
	 * @internal
	 * @see https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx#sandbox-proxy
	 */
	export interface McpUiSandboxProxyReadyNotification {
		method: "ui/notifications/sandbox-proxy-ready";
		params: {};
	}

	/**
	 * @description Notification containing HTML resource for the sandbox proxy to load.
	 * @internal
	 * @see https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx#sandbox-proxy
	 */
	export interface McpUiSandboxResourceReadyNotification {
		method: "ui/notifications/sandbox-resource-ready";
		params: {
			html: string;
			sandbox?: string;
			csp?: McpUiResourceCsp;
			permissions?: McpUiResourcePermissions;
		};
	}

	export interface McpUiSizeChangedNotification {
		method: "ui/notifications/size-changed";
		params: {
			width?: number;
			height?: number;
		};
	}

	export interface McpUiToolInputNotification {
		method: "ui/notifications/tool-input";
		params: {
			arguments?: Record<string, unknown>;
		};
	}

	export interface McpUiToolInputPartialNotification {
		method: "ui/notifications/tool-input-partial";
		params: {
			arguments?: Record<string, unknown>;
		};
	}

	export interface McpUiToolResultNotification {
		method: "ui/notifications/tool-result";
		params: CallToolResult;
	}

	export interface McpUiToolCancelledNotification {
		method: "ui/notifications/tool-cancelled";
		params: {
			reason?: string;
		};
	}

	export interface McpUiHostCss {
		fonts?: string;
	}

	export interface McpUiHostStyles {
		variables?: McpUiStyles;
		css?: McpUiHostCss;
	}

	export interface McpUiHostContext {
		[key: string]: unknown;
		toolInfo?: {
			id?: RequestId;
			tool: Tool;
		};
		theme?: McpUiTheme;
		styles?: McpUiHostStyles;
		displayMode?: McpUiDisplayMode;
		availableDisplayModes?: string[];
		containerDimensions?: (
			| {
				height: number;
			}
			| {
				maxHeight?: number | undefined;
			}
		) &
		(
			| {
				width: number;
			}
			| {
				maxWidth?: number | undefined;
			}
		);
		locale?: string;
		timeZone?: string;
		userAgent?: string;
		platform?: "web" | "desktop" | "mobile";
		deviceCapabilities?: {
			touch?: boolean;
			hover?: boolean;
		};
		safeAreaInsets?: {
			top: number;
			right: number;
			bottom: number;
			left: number;
		};
	}

	export interface McpUiHostContextChangedNotification {
		method: "ui/notifications/host-context-changed";
		params: McpUiHostContext;
	}

	export interface McpUiUpdateModelContextRequest {
		method: "ui/update-model-context";
		params: {
			content?: ContentBlock[];
			structuredContent?: Record<string, unknown>;
		};
	}

	export interface McpUiResourceTeardownRequest {
		method: "ui/resource-teardown";
		params: {};
	}

	export interface McpUiResourceTeardownResult {
		[key: string]: unknown;
	}

	export interface McpUiSupportedContentBlockModalities {
		text?: {};
		image?: {};
		audio?: {};
		resource?: {};
		resourceLink?: {};
		structuredContent?: {};
	}

	export interface McpUiHostCapabilities {
		experimental?: {};
		openLinks?: {};
		serverTools?: {
			listChanged?: boolean;
		};
		serverResources?: {
			listChanged?: boolean;
		};
		logging?: {};
		sandbox?: {
			permissions?: McpUiResourcePermissions;
			csp?: McpUiResourceCsp;
		};
		updateModelContext?: McpUiSupportedContentBlockModalities;
		message?: McpUiSupportedContentBlockModalities;
		downloadFile?: {};
	}

	export interface McpUiAppCapabilities {
		experimental?: {};
		tools?: {
			listChanged?: boolean;
		};
		availableDisplayModes?: McpUiDisplayMode[];
	}

	export interface McpUiInitializeRequest {
		method: "ui/initialize";
		params: {
			appInfo: Implementation;
			appCapabilities: McpUiAppCapabilities;
			protocolVersion: string;
		};
	}

	export interface McpUiInitializeResult {
		protocolVersion: string;
		hostInfo: Implementation;
		hostCapabilities: McpUiHostCapabilities;
		hostContext: McpUiHostContext;
		[key: string]: unknown;
	}

	export interface McpUiInitializedNotification {
		method: "ui/notifications/initialized";
		params?: {};
	}

	export interface McpUiResourceCsp {
		connectDomains?: string[];
		resourceDomains?: string[];
		frameDomains?: string[];
		baseUriDomains?: string[];
	}

	export interface McpUiResourcePermissions {
		camera?: {};
		microphone?: {};
		geolocation?: {};
		clipboardWrite?: {};
	}

	export interface McpUiResourceMeta {
		csp?: McpUiResourceCsp;
		permissions?: McpUiResourcePermissions;
		domain?: string;
		prefersBorder?: boolean;
	}

	export interface McpUiRequestDisplayModeRequest {
		method: "ui/request-display-mode";
		params: {
			mode: McpUiDisplayMode;
		};
	}

	export interface McpUiRequestDisplayModeResult {
		mode: McpUiDisplayMode;
		[key: string]: unknown;
	}

	export type McpUiToolVisibility = "model" | "app";

	export interface McpUiToolMeta {
		resourceUri?: string;
		visibility?: McpUiToolVisibility[];
	}

	export const OPEN_LINK_METHOD: McpUiOpenLinkRequest["method"] = "ui/open-link";
	export const MESSAGE_METHOD: McpUiMessageRequest["method"] = "ui/message";
	export const SANDBOX_PROXY_READY_METHOD: McpUiSandboxProxyReadyNotification["method"] =
		"ui/notifications/sandbox-proxy-ready";
	export const SANDBOX_RESOURCE_READY_METHOD: McpUiSandboxResourceReadyNotification["method"] =
		"ui/notifications/sandbox-resource-ready";
	export const SIZE_CHANGED_METHOD: McpUiSizeChangedNotification["method"] =
		"ui/notifications/size-changed";
	export const TOOL_INPUT_METHOD: McpUiToolInputNotification["method"] =
		"ui/notifications/tool-input";
	export const TOOL_INPUT_PARTIAL_METHOD: McpUiToolInputPartialNotification["method"] =
		"ui/notifications/tool-input-partial";
	export const TOOL_RESULT_METHOD: McpUiToolResultNotification["method"] =
		"ui/notifications/tool-result";
	export const TOOL_CANCELLED_METHOD: McpUiToolCancelledNotification["method"] =
		"ui/notifications/tool-cancelled";
	export const HOST_CONTEXT_CHANGED_METHOD: McpUiHostContextChangedNotification["method"] =
		"ui/notifications/host-context-changed";
	export const RESOURCE_TEARDOWN_METHOD: McpUiResourceTeardownRequest["method"] =
		"ui/resource-teardown";
	export const INITIALIZE_METHOD: McpUiInitializeRequest["method"] =
		"ui/initialize";
	export const INITIALIZED_METHOD: McpUiInitializedNotification["method"] =
		"ui/notifications/initialized";
	export const REQUEST_DISPLAY_MODE_METHOD: McpUiRequestDisplayModeRequest["method"] =
		"ui/request-display-mode";
	export const UPDATE_MODEL_CONTEXT_METHOD: McpUiUpdateModelContextRequest["method"] =
		"ui/update-model-context";
	export const DOWNLOAD_FILE_METHOD: McpUiDownloadFileRequest["method"] =
		"ui/download-file";
}

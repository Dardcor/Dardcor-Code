/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { Changeset } from '../channels-changeset/state.js';
import type { AnnotationsSummary } from '../channels-annotations/state.js';
import type { ChatSummary, ChatInputRequest, ToolCallConfirmationState, ToolCallRunningState, ToolCallAuthRequiredState } from '../channels-chat/state.js';
import type { ConfigPropertySchema, ErrorInfo, Icon, ProtectedResourceMetadata, TextRange, URI } from '../common/state.js';


export const enum SessionLifecycle {
	Creating = 'creating',
	Ready = 'ready',
	Failed = 'failed',
}

export const enum SessionStatus {
	Idle = 1,
	Error = 1 << 1,
	InProgress = 1 << 3,
	InputNeeded = (1 << 3) | (1 << 4),
	IsRead = 1 << 5,
	IsArchived = 1 << 6,
}

export const enum SessionOriginKind {
	Automation = 'automation',
}

export interface AutomationSessionOrigin {
	kind: SessionOriginKind.Automation;
	automation: URI;
	run: URI;
}

export type SessionOrigin = AutomationSessionOrigin;

export interface SessionMetadata {
	provider: string;
	title: string;
	status: SessionStatus;
	activity?: string;
	origin?: SessionOrigin;
	project?: ProjectInfo;
	workingDirectories?: URI[];
	annotations?: AnnotationsSummary;
}

export interface SessionState extends SessionMetadata {
	lifecycle: SessionLifecycle;
	creationError?: ErrorInfo;
	serverTools?: ToolDefinition[];
	activeClients: SessionActiveClient[];
	chats: ChatSummary[];
	defaultChat?: URI;
	config?: SessionConfigState;
	customizations?: Customization[];
	changesets?: Changeset[];
	inputNeeded?: SessionInputRequest[];
	_meta?: Record<string, unknown>;
}

export interface SessionActiveClient {
	clientId: string;
	displayName?: string;
	tools: ToolDefinition[];
	customizations?: ClientPluginCustomization[];
}


export const enum SessionInputRequestKind {
	ChatInput = 'chatInput',
	ToolConfirmation = 'toolConfirmation',
	ToolClientExecution = 'toolClientExecution',
	ToolAuthentication = 'toolAuthentication',
}

interface SessionInputRequestBase {
	id: string;
	chat: URI;
}

export interface SessionChatInputRequest extends SessionInputRequestBase {
	kind: SessionInputRequestKind.ChatInput;
	request: ChatInputRequest;
}

export interface SessionToolConfirmationRequest extends SessionInputRequestBase {
	kind: SessionInputRequestKind.ToolConfirmation;
	turnId: string;
	toolCall: ToolCallConfirmationState;
}

export interface SessionToolClientExecutionRequest extends SessionInputRequestBase {
	kind: SessionInputRequestKind.ToolClientExecution;
	turnId: string;
	clientId: string;
	toolCall: ToolCallRunningState;
}

export interface SessionToolAuthenticationRequest extends SessionInputRequestBase {
	kind: SessionInputRequestKind.ToolAuthentication;
	turnId: string;
	toolCall: ToolCallAuthRequiredState;
}

export type SessionInputRequest =
	| SessionChatInputRequest
	| SessionToolConfirmationRequest
	| SessionToolClientExecutionRequest
	| SessionToolAuthenticationRequest;

export interface ProjectInfo {
	uri: URI;
	displayName: string;
}

export interface SessionSummary extends SessionMetadata {
	resource: URI;
	createdAt: string;
	modifiedAt: string;
	changes?: ChangesSummary;
	_meta?: Record<string, unknown>;
}

export interface ChangesSummary {
	additions?: number;
	deletions?: number;
	files?: number;
}


export interface AgentSelection {
	uri: URI;
}


export interface SessionConfigPropertySchema extends ConfigPropertySchema {
	enumDynamic?: boolean;
	sessionMutable?: boolean;
}

export interface SessionConfigSchema {
	type: 'object';
	properties: Record<string, SessionConfigPropertySchema>;
	required?: string[];
}

export interface SessionConfigState {
	schema: SessionConfigSchema;
	values: Record<string, unknown>;
}


export interface ToolDefinition {
	name: string;
	title?: string;
	description?: string;
	inputSchema?: {
		type: 'object';
		properties?: Record<string, object>;
		required?: string[];
	};
	outputSchema?: {
		type: 'object';
		properties?: Record<string, object>;
		required?: string[];
	};
	annotations?: ToolAnnotations;
	_meta?: Record<string, unknown>;
}

export interface ToolAnnotations {
	title?: string;
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	idempotentHint?: boolean;
	openWorldHint?: boolean;
}


export const enum CustomizationType {
	Plugin = 'plugin',
	Directory = 'directory',
	Agent = 'agent',
	Skill = 'skill',
	Prompt = 'prompt',
	Rule = 'rule',
	Hook = 'hook',
	McpServer = 'mcpServer',
}

export const enum CustomizationEnablementKind {
	Global = 'global',
	Workspace = 'workspace',
	Session = 'session',
}

export type CustomizationEnablement =
	| { kind: CustomizationEnablementKind.Global; enabled: boolean }
	| { kind: CustomizationEnablementKind.Workspace; uri: URI; enabled: boolean }
	| { kind: CustomizationEnablementKind.Session; enabled: boolean };

export type ChildCustomizationType =
	| CustomizationType.Agent
	| CustomizationType.Skill
	| CustomizationType.Prompt
	| CustomizationType.Rule
	| CustomizationType.Hook
	| CustomizationType.McpServer;

interface CustomizationBase {
	id: string;
	uri: URI;
	name: string;
	icons?: Icon[];
	range?: TextRange;
	_meta?: Record<string, unknown>;
}

export const enum CustomizationLoadStatus {
	Loading = 'loading',
	Loaded = 'loaded',
	Degraded = 'degraded',
	Error = 'error',
}

export interface CustomizationLoadingState {
	kind: CustomizationLoadStatus.Loading;
}

export interface CustomizationLoadedState {
	kind: CustomizationLoadStatus.Loaded;
}

export interface CustomizationDegradedState {
	kind: CustomizationLoadStatus.Degraded;
	message: string;
}

export interface CustomizationErrorState {
	kind: CustomizationLoadStatus.Error;
	message: string;
}

export type CustomizationLoadState =
	| CustomizationLoadingState
	| CustomizationLoadedState
	| CustomizationDegradedState
	| CustomizationErrorState;

interface ContainerCustomizationBase extends CustomizationBase {
	clientId?: string;
	load?: CustomizationLoadState;
	children?: ChildCustomization[];
}

export interface PluginCustomization extends ContainerCustomizationBase {
	type: CustomizationType.Plugin;
	enablement?: CustomizationEnablement[];
	version?: string;
}

export interface ClientPluginCustomization extends PluginCustomization {
	nonce?: string;
	/**
	 * Explicit enablement decisions for children this plugin contributes,
	 * keyed by child name (for MCP servers, the server name as it appears in
	 * the bundled `.mcp.json`).
	 *
	 * Bundled children are discovered by the host rather than published by the
	 * client, so the client cannot attach `enablement` to them directly. This
	 * carries the client's global decision for each one; the host applies it
	 * under the child's durable key.
	 */
	childEnablement?: Record<string, CustomizationEnablement[]>;
}

export interface DirectoryCustomization extends ContainerCustomizationBase {
	type: CustomizationType.Directory;
	enabled: boolean;
	contents: ChildCustomizationType;
	writable: boolean;
}

interface ChildCustomizationBase extends CustomizationBase {
	enabled?: boolean;
}

export interface AgentCustomization extends ChildCustomizationBase {
	type: CustomizationType.Agent;
	description?: string;
	model?: string;
	tools?: string[];
	disableModelInvocation?: boolean;
	disableUserInvocation?: boolean;
}

export interface SkillCustomization extends ChildCustomizationBase {
	type: CustomizationType.Skill;
	description?: string;
	disableModelInvocation?: boolean;
	disableUserInvocation?: boolean;
}

export interface PromptCustomization extends ChildCustomizationBase {
	type: CustomizationType.Prompt;
	description?: string;
}

export interface RuleCustomization extends ChildCustomizationBase {
	type: CustomizationType.Rule;
	description?: string;
	alwaysApply?: boolean;
	globs?: string[];
}

export interface HookCustomization extends ChildCustomizationBase {
	type: CustomizationType.Hook;
}

export interface McpServerCustomization extends CustomizationBase {
	type: CustomizationType.McpServer;
	/**
	 * Explicit enablement decisions for this customization, one entry per scope
	 * that has one. This is a wire contract: producers MUST publish entries
	 * sorted by descending specificity (Session, Workspace, then Global).
	 * The agent host emits at most one Workspace entry, for the session's primary
	 * working directory. Consumers MAY treat
	 * `enablement[0]` as the decisive decision and
	 * `enablement?.[0]?.enabled ?? true` as the effective enabled value. An
	 * absent or empty array means no explicit decision exists, so the
	 * customization is enabled by default.
	 *
	 * Flows in both directions. A client publishes this alongside a customization
	 * to assert its global decision, which is authoritative for the Global scope;
	 * a client always includes its global entry, even when enabled. The host
	 * publishes the fully resolved set across all scopes, and consumers derive
	 * the effective enabled value from that set.
	 */
	enablement?: CustomizationEnablement[];
	state: McpServerState;
	channel?: URI;
	mcpApp?: McpServerCustomizationApps;
}

export interface McpServerCustomizationApps {
	capabilities: AhpMcpUiHostCapabilities;
}

export interface AhpMcpUiHostCapabilities {
	serverTools?: {
		listChanged?: boolean;
	};
	serverResources?: {
		listChanged?: boolean;
	};
	logging?: Record<string, never>;
	sampling?: {
		tools?: Record<string, never>;
	};
}

export type ChildCustomization =
	| AgentCustomization
	| SkillCustomization
	| PromptCustomization
	| RuleCustomization
	| HookCustomization
	| McpServerCustomization;

export type Customization =
	| PluginCustomization
	| DirectoryCustomization
	| McpServerCustomization;



export const enum McpServerStatus {
	Starting = 'starting',
	Ready = 'ready',
	AuthRequired = 'authRequired',
	Error = 'error',
	Stopped = 'stopped',
}

export const enum McpAuthRequiredReason {
	Required = 'required',
	Expired = 'expired',
	InsufficientScope = 'insufficientScope',
}

export interface McpServerStartingState {
	kind: McpServerStatus.Starting;
}

export interface McpServerReadyState {
	kind: McpServerStatus.Ready;
}

export interface McpOAuthClient {
	clientId: string;
	clientSecret?: string;
}

export interface McpAuthRequirement {
	reason: McpAuthRequiredReason;
	oauthClient?: McpOAuthClient;
	resource: ProtectedResourceMetadata;
	requiredScopes?: string[];
	description?: string;
}

export interface McpServerAuthRequiredState extends McpAuthRequirement {
	kind: McpServerStatus.AuthRequired;
}

export interface McpServerErrorState {
	kind: McpServerStatus.Error;
	error: ErrorInfo;
}

export interface McpServerStoppedState {
	kind: McpServerStatus.Stopped;
}

export type McpServerState =
	| McpServerStartingState
	| McpServerReadyState
	| McpServerAuthRequiredState
	| McpServerErrorState
	| McpServerStoppedState;

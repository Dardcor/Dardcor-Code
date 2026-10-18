/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { URI, Snapshot } from './state.js';
import type { ActionEnvelope, StateAction } from './actions.js';
import type { TelemetryCapabilities } from '../channels-otlp/state.js';


export interface BaseParams {
	channel: URI;
	_meta?: Record<string, unknown>;
}


export interface PaginatedParams {
	limit?: number;
	cursor?: string;
}

export interface PaginatedResult {
	nextCursor?: string;
}


export interface Implementation {
	name: string;
	version?: string;
	title?: string;
}

export interface InitializeParams extends BaseParams {
	channel: 'ahp-root://';
	protocolVersions: string[];
	clientId: string;
	clientInfo?: Implementation;
	initialSubscriptions?: URI[];
	locale?: string;
	capabilities?: ClientCapabilities;
}

export interface ClientCapabilities {
	mcpApps?: Record<string, never>;
}

export interface InitializeResult {
	protocolVersion: string;
	serverSeq: number;
	serverInfo?: Implementation;
	_meta?: Record<string, unknown>;
	snapshots: Snapshot[];
	defaultDirectory?: URI;
	completionTriggerCharacters?: string[];
	terminalCommandPrefix?: string;
	telemetry?: TelemetryCapabilities;
	automations?: AutomationCapabilities;
}

export interface AutomationCapabilities {
	create?: AutomationCreateCapability;
	schedules?: AutomationScheduleCapabilities;
	runCancellation?: AutomationRunCancellationCapability;
	runHistoryLimit?: number;
}

export interface AutomationCreateCapability { }

export interface AutomationScheduleCapabilities {
	minIntervalMinutes?: number;
}

export interface AutomationRunCancellationCapability { }


export interface PingParams extends BaseParams {
	channel: 'ahp-root://';
}


export const enum ReconnectResultType {
	Replay = 'replay',
	Snapshot = 'snapshot',
}

export interface ReconnectParams extends BaseParams {
	channel: 'ahp-root://';
	clientId: string;
	lastSeenServerSeq: number;
	subscriptions: URI[];
}

export interface ReconnectReplayResult {
	type: ReconnectResultType.Replay;
	actions: ActionEnvelope[];
	missing: URI[];
}

export interface ReconnectSnapshotResult {
	type: ReconnectResultType.Snapshot;
	snapshots: Snapshot[];
}

export type ReconnectResult = ReconnectReplayResult | ReconnectSnapshotResult;


export interface SubscribeParams extends BaseParams {
	delivery?: SubscriptionDeliveryOptions;
	view?: SubscribeView;
}

export interface SubscribeView {
	turns?: number;
}

export interface SubscriptionDeliveryOptions {
	maxLatencyMs?: number;
}

export interface SubscribeResult {
	snapshot?: Snapshot;
}


export interface UnsubscribeParams {
	channel: URI;
}


export interface DispatchActionParams {
	channel: URI;
	clientSeq: number;
	action: StateAction;
}


export const enum ContentEncoding {
	Base64 = 'base64',
	Utf8 = 'utf-8',
}

export interface ResourceReadParams extends BaseParams {
	channel: 'ahp-root://';
	uri: string;
	encoding?: ContentEncoding;
}

export interface ResourceReadResult {
	data: string;
	encoding: ContentEncoding;
	contentType?: string;
}


export const enum ResourceWriteMode {
	Truncate = 'truncate',
	Append = 'append',
	Insert = 'insert',
}

export interface ResourceWriteParams extends BaseParams {
	channel: 'ahp-root://';
	uri: URI;
	data: string;
	encoding: ContentEncoding;
	contentType?: string;
	createOnly?: boolean;
	mode?: ResourceWriteMode;
	position?: number;
	ifMatch?: string;
}

export interface ResourceWriteResult {
}


export interface ResourceListParams extends BaseParams {
	channel: 'ahp-root://';
	uri: URI;
}

export interface DirectoryEntry {
	name: string;
	type: 'file' | 'directory';
}

export interface ResourceListResult {
	entries: DirectoryEntry[];
}


export interface ResourceCopyParams extends BaseParams {
	channel: 'ahp-root://';
	source: URI;
	destination: URI;
	failIfExists?: boolean;
}

export interface ResourceCopyResult {
}


export interface ResourceDeleteParams extends BaseParams {
	channel: 'ahp-root://';
	uri: URI;
	recursive?: boolean;
}

export interface ResourceDeleteResult {
}


export interface ResourceRequestParams extends BaseParams {
	channel: 'ahp-root://';
	uri: URI;
	read?: boolean;
	write?: boolean;
}

export interface ResourceRequestResult {
}


export interface ResourceMoveParams extends BaseParams {
	channel: 'ahp-root://';
	source: URI;
	destination: URI;
	failIfExists?: boolean;
}

export interface ResourceMoveResult {
}


export const enum ResourceType {
	File = 'file',
	Directory = 'directory',
	Symlink = 'symlink',
}

export interface ResourceResolveParams extends BaseParams {
	channel: 'ahp-root://';
	uri: URI;
	followSymlinks?: boolean;
}

export interface ResourceResolveResult {
	uri: URI;
	type: ResourceType;
	size?: number;
	mtime?: string;
	ctime?: string;
	contentType?: string;
	etag?: string;
}


export interface ResourceMkdirParams extends BaseParams {
	channel: 'ahp-root://';
	uri: URI;
}

export interface ResourceMkdirResult {
}


export interface AuthenticateParams extends BaseParams {
	channel: 'ahp-root://';
	resource: string;
	token: string;
	scopes?: string[];
}

export interface AuthenticateResult {
}

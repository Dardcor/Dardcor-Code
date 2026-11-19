/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { RootState } from '../channels-root/state.js';
import type { SessionState } from '../channels-session/state.js';
import type { TerminalState } from '../channels-terminal/state.js';
import type { ChangesetState } from '../channels-changeset/state.js';
import type { ResourceWatchState } from '../channels-resource-watch/state.js';
import type { AnnotationsState } from '../channels-annotations/state.js';
import type { ChatState } from '../channels-chat/state.js';
import type { AutomationState } from '../channels-automation/state.js';
import type { AutomationRunState } from '../channels-automation-run/state.js';


export type URI = string;

export type StringOrMarkdown = string | { markdown: string };

export type JsonPrimitive = string | number | boolean | null;


export interface Icon {
	src: URI;

	contentType?: string;

	sizes?: string[];

	theme?: 'light' | 'dark';
}


export interface ProtectedResourceMetadata {
	resource: string;

	resource_name?: string;

	authorization_servers?: string[];

	jwks_uri?: string;

	scopes_supported?: string[];

	bearer_methods_supported?: string[];

	resource_signing_alg_values_supported?: string[];

	resource_documentation?: string;

	resource_policy_uri?: string;

	resource_tos_uri?: string;

	required?: boolean;
}


export interface ConfigPropertySchema {
	type: 'string' | 'number' | 'boolean' | 'array' | 'object';
	title: string;
	description?: string;
	default?: unknown;
	enum?: JsonPrimitive[];
	enumLabels?: string[];
	enumDescriptions?: string[];
	readOnly?: boolean;
	items?: ConfigPropertySchema;
	properties?: Record<string, ConfigPropertySchema>;
	required?: string[];
	additionalProperties?: ConfigPropertySchema;
}

export interface ConfigSchema {
	type: 'object';
	properties: Record<string, ConfigPropertySchema>;
	required?: string[];
}


export interface TextPosition {
	line: number;
	character: number;
}

export interface TextRange {
	start: TextPosition;
	end: TextPosition;
}

export interface TextSelection {
	range: TextRange;
}


export interface ContentRef {
	uri: URI;
	sizeHint?: number;
	contentType?: string;
	nonce?: string;
}


export interface FileEdit {
	before?: {
		uri: URI;
		content: ContentRef;
	};
	after?: {
		uri: URI;
		content: ContentRef;
	};
	diff?: {
		added?: number;
		removed?: number;
	};
}


export interface UsageInfo {
	inputTokens?: number;
	outputTokens?: number;
	model?: string;
	cacheReadTokens?: number;
	_meta?: Record<string, unknown>;
}

export interface ErrorInfo {
	errorType: string;
	message: string;
	stack?: string;
	_meta?: Record<string, unknown>;
}

export interface Snapshot {
	resource: URI;
	state: RootState | SessionState | TerminalState | ChangesetState | ResourceWatchState | AnnotationsState | ChatState | AutomationState | AutomationRunState;
	fromSeq: number;
}

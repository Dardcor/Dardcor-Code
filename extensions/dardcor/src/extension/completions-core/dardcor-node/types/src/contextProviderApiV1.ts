/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Diagnostic, Uri } from 'vscode';
import {
	CancellationToken,
	Disposable,
	DocumentSelector,
	DocumentUri,
	Position,
	TextEdit,
} from 'vscode-languageserver-protocol';

/**
 * The ContextProvider API allows extensions to provide additional context items that
 * Dardcor can use in its prompt. This file contains type definitions for the methods
 * and the data structures used by the API.
 *
 * Note: providing context is not enough to ensure that the context will be used in the prompt.
 *
 * The API is exposed as an export of the Dardcor extension. To use it, you can cast the
 * exported object to the ContextProviderApiV1 interface.
 *
 * Example:
 * ```
 * const dardcor = vscode.extensions.getExtension("github.dardcor");
 * const contextProviderAPI = dardcor.exports.getContextProviderAPI("v1") as ContextProviderApiV1;
 * ```
 */
export interface ContextProviderApiV1 {
	registerContextProvider<T extends SupportedContextItem>(provider: ContextProvider<T>): Disposable;
}

export interface ContextProvider<T extends SupportedContextItem> {
	id: string;
	selector: DocumentSelector;
	resolver: ContextResolver<T>;
}

export type ResolveOnTimeoutResult<T> = T | readonly T[];
export type ResolveResult<T> = Promise<T> | Promise<readonly T[]> | AsyncIterable<T>;

export interface ContextResolver<T extends SupportedContextItem> {
	resolve(request: ResolveRequest, token: CancellationToken): ResolveResult<T>;
	resolveOnTimeout?(request: ResolveRequest): ResolveOnTimeoutResult<T> | undefined;
}

export type ResolutionStatus = 'full' | 'partial' | 'none' | 'error';
export type UsageStatus = ResolutionStatus | 'partial_content_excluded' | 'none_content_excluded';

export type ContextItemUsageDetails = {
	id: string;
	type: SupportedContextItemType;
	origin?: ContextItemOrigin;
} & (
		| {
			usage: Extract<UsageStatus, 'full' | 'partial' | 'partial_content_excluded'>;
			expectedTokens: number;
			actualTokens: number;
		}
		| { usage: Extract<UsageStatus, 'none' | 'none_content_excluded' | 'error'> }
	);

export type ContextUsageStatistics = {
	usage: UsageStatus;
	resolution: ResolutionStatus;
	usageDetails?: ContextItemUsageDetails[];
};

export type ProposedTextEdit = TextEdit & {
	positionAfterEdit: Position;
	source?: 'selectedCompletionInfo';
};

export interface DocumentContext {
	uri: DocumentUri;
	languageId: string;
	version: number;
	offset: number;
	position: Position;
	proposedEdits?: ProposedTextEdit[];
}
export interface ResolveRequest {
	completionId: string;
	opportunityId: string;
	documentContext: DocumentContext;

	activeExperiments: Map<string, string | number | boolean | string[]>;

	timeBudget: number;

	timeoutEnd: number;

	previousUsageStatistics?: ContextUsageStatistics;

	data?: unknown;
}

interface ContextItem {
	importance?: number;

	id?: string;

	origin?: ContextItemOrigin;
}

export interface Trait extends ContextItem {
	name: string;
	value: string;
}

export interface CodeSnippet extends ContextItem {
	uri: string;
	value: string;
	additionalUris?: string[];
}

export interface DiagnosticBag extends ContextItem {
	uri: Uri;
	values: Diagnostic[];
}

export type SupportedContextItem = Trait | CodeSnippet | DiagnosticBag;
export type SupportedContextItemType = 'Trait' | 'CodeSnippet' | 'DiagnosticBag';
export type ContextItemOrigin = 'request' | 'update';
export namespace ContextItemOrigin {
	export function is(value: string): value is ContextItemOrigin {
		return value === 'request' || value === 'update';
	}
}

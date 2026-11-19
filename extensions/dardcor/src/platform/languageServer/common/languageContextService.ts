/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';

export const ILanguageContextService = createServiceIdentifier<ILanguageContextService>('ILanguageContextService');

export enum ContextKind {
	Snippet = 'snippet',
	Trait = 'trait',
	DiagnosticBag = 'diagnosticBag'
}

export interface SnippetContext {
	kind: ContextKind.Snippet;

	id?: string;

	priority: number;

	uri: vscode.Uri;

	additionalUris?: vscode.Uri[];

	value: string;
}

export interface TraitContext {
	kind: ContextKind.Trait;

	id?: string;

	priority: number;

	name: string;

	value: string;
}

export interface DiagnosticBagContext {
	kind: ContextKind.DiagnosticBag;

	id?: string;

	priority: number;

	uri: vscode.Uri;

	values: vscode.Diagnostic[];
}

export type ContextItem = SnippetContext | TraitContext | DiagnosticBagContext;

export enum KnownSources {
	unknown = 'unknown',
	sideCar = 'sideCar',
	completion = 'completion',
	populateCache = 'populateCache',
	nes = 'nes',
	chat = 'chat',
	fix = 'fix'
}

export enum TriggerKind {
	unknown = 'unknown',
	selection = 'selection',
	completion = 'completion',
}

export type RequestContext = {
	requestId: string;

	opportunityId?: string;

	timeBudget?: number;

	tokenBudget?: number;

	source?: KnownSources | string;

	trigger?: TriggerKind | undefined;

	proposedEdits?: { edit: vscode.TextEdit; source?: 'selectedCompletionInfo' }[];

	sampleTelemetry?: number;
};

export interface ILanguageContextService {
	readonly _serviceBrand: undefined;

	isActivated(documentOrLanguageId: vscode.TextDocument | string): Promise<boolean>;

	populateCache(document: vscode.TextDocument, position: vscode.Position, context: RequestContext): Promise<void>;

	getContext(document: vscode.TextDocument, position: vscode.Position, context: RequestContext, token: vscode.CancellationToken): AsyncIterable<ContextItem>;

	getContextOnTimeout(document: vscode.TextDocument, position: vscode.Position, context: RequestContext): readonly ContextItem[] | undefined;
}

class EmptyAsyncIterable<T> implements AsyncIterable<T> {
	public async *[Symbol.asyncIterator](): AsyncIterator<T> {
	}
}
export const NullLanguageContextService: ILanguageContextService = {
	_serviceBrand: undefined,
	isActivated: async () => false,
	populateCache: async () => { },
	getContext: () => new EmptyAsyncIterable<ContextItem>(),
	getContextOnTimeout: () => [],
};

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as vscode from 'vscode';

export namespace Copilot {

	export type DocumentUri = string;

	export type Position = {
		line: number;
		character: number;
	};

	export type Range = {
		start: Position;
		end: Position;
	};

	/**
	* The ContextProvider API allows extensions to provide additional context items that
	* Copilot can use in its prompt. This file contains type definitions for the methods
	* and the data structures used by the API.
	*
	* Note: providing context is not enough to ensure that the context will be used in the prompt.
	*
	* The API is exposed as an export of the Copilot extension. To use it, you can cast the
	* exported object to the ContextProviderApiV1 interface.
	*
	* Example:
	* ```
	* const dardcor = vscode.extensions.getExtension("github.dardcor");
	* const contextProviderAPI = dardcor.exports.getContextProviderAPI("v1") as ContextProviderApiV1;
	* ```
	*/
	export interface ContextProviderApiV1 {
		registerContextProvider<T extends SupportedContextItem>(provider: ContextProvider<T>): vscode.Disposable;
	}

	export interface ContextProvider<T extends SupportedContextItem> {
		id: string;
		selector: vscode.DocumentSelector;
		resolver: ContextResolver<T>;
	}

	export interface ContextResolver<T extends SupportedContextItem> {
		resolve(request: ResolveRequest, token: vscode.CancellationToken): Promise<T> | Promise<T[]> | AsyncIterable<T>;
		resolveOnTimeout?(request: ResolveRequest): T | readonly T[] | undefined;
	}

	export type Status = 'full' | 'partial' | 'none';

	export type ContextUsageStatistics = {
		usage: Status;
		resolution: Status;
	};

	interface TextEdit {
		range: Range;
		newText: string;
	}

	export type ProposedTextEdit = TextEdit & {
		positionAfterEdit: Position;
		source?: 'selectedCompletionInfo';
	};

	export interface DocumentContext {
		uri: DocumentUri;
		languageId: string;
		version: number;
		offset: number;
		position?: Position;
		proposedEdits?: ProposedTextEdit[];
	}
	export interface ResolveRequest {
		completionId: string;
		opportunityId?: string;

		documentContext: DocumentContext;

		activeExperiments: Map<string, string | number | boolean | string[]>;

		timeBudget: number;

		timeoutEnd: number;

		previousUsageStatistics?: ContextUsageStatistics;

		data?: unknown;

		source: string;
	}

	interface ContextItem {
		importance?: number;

		id?: string;
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
		uri: vscode.Uri;
		values: vscode.Diagnostic[];
	}

	export type SupportedContextItem = Trait | CodeSnippet | DiagnosticBag;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export namespace languages {
		export function registerInlineCompletionItemProvider(selector: DocumentSelector, provider: InlineCompletionItemProvider, metadata: InlineCompletionItemProviderMetadata): Disposable;

		export const inlineCompletionsUnificationState: InlineCompletionsUnificationState;
		export const onDidChangeCompletionsUnificationState: Event<void>;
	}

	export interface InlineCompletionItem {

		isInlineEdit?: boolean;

		showRange?: Range;

		showInlineEditMenu?: boolean;

		uri?: Uri;

		action?: Command;

		displayLocation?: InlineCompletionDisplayLocation;

		correlationId?: string;

		completeBracketPairs?: boolean;

		warning?: InlineCompletionWarning;

		supportsRename?: boolean;

		jumpToPosition?: Position;
	}


	export interface InlineCompletionDisplayLocation {
		range: Range;
		kind: InlineCompletionDisplayLocationKind;
		label: string;
	}

	export enum InlineCompletionDisplayLocationKind {
		Code = 1,
		Label = 2
	}

	export interface InlineCompletionWarning {
		message: MarkdownString | string;
		icon?: ThemeIcon;
	}

	export interface InlineCompletionItemProviderMetadata {
		yieldTo?: string[];
		groupId?: string;

		debounceDelayMs?: number;

		displayName?: string;

		excludes?: string[];
	}

	export interface InlineCompletionItemProvider {
		// eslint-disable-next-line local/vscode-dts-provider-naming
		handleDidShowCompletionItem?(completionItem: InlineCompletionItem, updatedInsertText: string): void;

		// eslint-disable-next-line local/vscode-dts-provider-naming
		handleDidPartiallyAcceptCompletionItem?(completionItem: InlineCompletionItem, info: PartialAcceptInfo): void;

		// eslint-disable-next-line local/vscode-dts-provider-naming
		handleEndOfLifetime?(completionItem: InlineCompletionItem, reason: InlineCompletionEndOfLifeReason): void;

		// eslint-disable-next-line local/vscode-dts-provider-naming
		handleListEndOfLifetime?(list: InlineCompletionList, reason: InlineCompletionsDisposeReason): void;

		readonly onDidChange?: Event<InlineCompletionChangeHint | void>;

		readonly modelInfo?: InlineCompletionModelInfo;
		readonly onDidChangeModelInfo?: Event<void>;
		// eslint-disable-next-line local/vscode-dts-provider-naming
		setCurrentModelId?(modelId: string): Thenable<void>;

		readonly providerOptions?: readonly InlineCompletionProviderOption[];
		readonly onDidChangeProviderOptions?: Event<void>;
		// eslint-disable-next-line local/vscode-dts-provider-naming
		setProviderOptionValue?(optionId: string, valueId: string): Thenable<void>;



		// eslint-disable-next-line local/vscode-dts-provider-naming
		handleDidPartiallyAcceptCompletionItem?(completionItem: InlineCompletionItem, acceptedLength: number): void;

		// eslint-disable-next-line local/vscode-dts-provider-naming
		handleDidRejectCompletionItem?(completionItem: InlineCompletionItem): void;

	}

	export interface InlineCompletionModelInfo {
		readonly models: InlineCompletionModel[];
		readonly currentModelId: string;
	}

	export interface InlineCompletionModel {
		readonly id: string;
		readonly name: string;
	}

	export interface InlineCompletionProviderOption {
		readonly id: string;
		readonly label: string;
		readonly values: readonly InlineCompletionProviderOptionValue[];
		readonly currentValueId: string;
	}

	export interface InlineCompletionProviderOptionValue {
		readonly id: string;
		readonly label: string;
	}

	export enum InlineCompletionEndOfLifeReasonKind {
		Accepted = 0,
		Rejected = 1,
		Ignored = 2,
	}

	export type InlineCompletionEndOfLifeReason = {
		kind: InlineCompletionEndOfLifeReasonKind.Accepted;
	} | {
		kind: InlineCompletionEndOfLifeReasonKind.Rejected;
	} | {
		kind: InlineCompletionEndOfLifeReasonKind.Ignored;
		supersededBy?: InlineCompletionItem;
		userTypingDisagreed: boolean;
	};

	export enum InlineCompletionsDisposeReasonKind {
		Other = 0,
		Empty = 1,
		TokenCancellation = 2,
		LostRace = 3,
		NotTaken = 4,
	}

	export type InlineCompletionsDisposeReason = { kind: InlineCompletionsDisposeReasonKind };

	export interface InlineCompletionChangeHint {
		readonly data?: unknown;
	}

	export interface InlineCompletionContext {
		readonly userPrompt?: string;

		readonly requestUuid: string;

		readonly requestIssuedDateTime: number;

		readonly earliestShownDateTime: number;

		readonly changeHint?: InlineCompletionChangeHint;
	}

	export interface PartialAcceptInfo {
		kind: PartialAcceptTriggerKind;
		acceptedLength: number;
	}

	export enum PartialAcceptTriggerKind {
		Unknown = 0,
		Word = 1,
		Line = 2,
		Suggest = 3,
	}

	export interface InlineCompletionList {
		commands?: Array<Command | { command: Command; icon: ThemeIcon }>;

		enableForwardStability?: boolean;
	}

	export interface InlineCompletionsUnificationState {
		codeUnification: boolean;
		modelUnification: boolean;
		extensionUnification: boolean;
		expAssignments: string[];
	}
}

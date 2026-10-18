/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { IMarkdownString } from '../../../../../base/common/htmlContent.js';
import { basename } from '../../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { IRange } from '../../../../../editor/common/core/range.js';
import { IOffsetRange } from '../../../../../editor/common/core/ranges/offsetRange.js';
import { isLocation, Location, SymbolKind } from '../../../../../editor/common/languages.js';
import { localize } from '../../../../../nls.js';
import { MarkerSeverity, IMarker } from '../../../../../platform/markers/common/markers.js';
import type { IFeedbackPullRequest } from '../../../../../platform/agentHost/common/meta/agentFeedbackAnnotations.js';
import { ISCMHistoryItem } from '../../../scm/common/history.js';
import { IChatContentReference } from '../chatService/chatService.js';
import { IChatRequestVariableValue } from './chatVariables.js';
import { IToolData, IToolSet } from '../tools/languageModelToolsService.js';
import type { ILanguageModelChatMetadata } from '../languageModels.js';
import { decodeBase64, encodeBase64, VSBuffer } from '../../../../../base/common/buffer.js';
import { Mutable } from '../../../../../base/common/types.js';


export type ChatContextIconPath = ThemeIcon | URI | { light: URI; dark: URI };

export function isChatContextIconPath(value: unknown): value is ChatContextIconPath {
	if (!value || typeof value !== 'object') {
		return false;
	}
	if (ThemeIcon.isThemeIcon(value) || URI.isUri(value)) {
		return true;
	}
	const asDualPath = value as { light?: unknown; dark?: unknown };
	return URI.isUri(asDualPath.light) && URI.isUri(asDualPath.dark);
}

export function resolveChatContextIcon(iconPath: ChatContextIconPath, useDark: boolean): ThemeIcon | URI {
	if (ThemeIcon.isThemeIcon(iconPath) || URI.isUri(iconPath)) {
		return iconPath;
	}
	return useDark ? iconPath.dark : iconPath.light;
}

interface IBaseChatRequestVariableEntry {
	readonly id: string;
	readonly fullName?: string;
	readonly icon?: ThemeIcon;
	readonly name: string;
	readonly modelDescription?: string;

	readonly range?: IOffsetRange;
	readonly value: IChatRequestVariableValue;
	readonly references?: IChatContentReference[];

	readonly _meta?: Record<string, unknown>;

	omittedState?: OmittedState;
}

export interface IGenericChatRequestVariableEntry extends IBaseChatRequestVariableEntry {
	kind: 'generic';
	tooltip?: IMarkdownString;
	iconPath?: ChatContextIconPath;
}

export const ChatPasteAttachmentMetadata = {
	Kind: 'vscode.chat.attachment.kind',
	Language: 'vscode.chat.attachment.language',
	FileName: 'vscode.chat.attachment.fileName',
	PastedLines: 'vscode.chat.attachment.pastedLines',
	TextArtifact: 'vscode.chat.attachment.textArtifact',
} as const;

const ChatTranscriptContextMetadataKey = 'dardcor.chat.transcriptContext';
export const ChatTranscriptContextAttachmentDisplayKind = 'transcriptContext';

export interface IRestorablePasteAttachment {
	readonly label: string;
	readonly displayKind?: string;
	readonly modelRepresentation?: string;
	readonly _meta?: Record<string, unknown>;
}

export const enum AgentHostCompletionReferenceKind {
	Skill = 'skill',
	Command = 'command',
}

export interface IAgentHostCompletionVariableValue {
	readonly $mid: 'agentHostCompletion';
	readonly kind: AgentHostCompletionReferenceKind;
}

function agentHostCompletionVariableValue(kind: AgentHostCompletionReferenceKind): IAgentHostCompletionVariableValue {
	return { $mid: 'agentHostCompletion', kind };
}

function agentHostCompletionVariableId(kind: AgentHostCompletionReferenceKind, reference: URI | string): string {
	switch (kind) {
		case AgentHostCompletionReferenceKind.Skill:
			return reference.toString();
		case AgentHostCompletionReferenceKind.Command:
			return 'agent-host-command:' + reference.toString();
	}
}

export function toAgentHostCompletionVariableEntry(kind: AgentHostCompletionReferenceKind, name: string, reference: URI | string | undefined, _meta: Record<string, unknown> | undefined): IGenericChatRequestVariableEntry & { value: IAgentHostCompletionVariableValue } {
	return {
		kind: 'generic',
		id: reference !== undefined ? agentHostCompletionVariableId(kind, reference) : generateUuid(),
		name,
		value: agentHostCompletionVariableValue(kind),
		_meta,
	};
}

export function toAgentHostCompletionVariableEntryFromMetadata(kind: AgentHostCompletionReferenceKind, name: string, _meta: Record<string, unknown> | undefined): IGenericChatRequestVariableEntry & { value: IAgentHostCompletionVariableValue } {
	switch (kind) {
		case AgentHostCompletionReferenceKind.Skill:
			return toAgentHostCompletionVariableEntry(kind, name, typeof _meta?.uri === 'string' ? _meta.uri : undefined, _meta);
		case AgentHostCompletionReferenceKind.Command:
			return toAgentHostCompletionVariableEntry(kind, name, typeof _meta?.command === 'string' ? _meta.command : undefined, _meta);
	}
}

export function getAgentHostCompletionReferenceKind(entry: IChatRequestVariableEntry): AgentHostCompletionReferenceKind | undefined {
	if (entry.kind !== 'generic') {
		return undefined;
	}
	return getAgentHostCompletionReferenceKindFromValue(entry.value);
}

export function getAgentHostCompletionReferenceKindFromValue(value: IChatRequestVariableValue): AgentHostCompletionReferenceKind | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}

	const record = value as Record<string, unknown>;
	if (record.$mid !== 'agentHostCompletion') {
		return undefined;
	}

	switch (record.kind) {
		case AgentHostCompletionReferenceKind.Skill:
		case AgentHostCompletionReferenceKind.Command:
			return record.kind;
	}
	return undefined;
}

export function isAgentHostCompletionVariableEntry(entry: IChatRequestVariableEntry): entry is IGenericChatRequestVariableEntry & { value: IAgentHostCompletionVariableValue } {
	return getAgentHostCompletionReferenceKind(entry) !== undefined;
}


export interface IChatRequestDirectoryEntry extends IBaseChatRequestVariableEntry {
	kind: 'directory';
	imageCount?: number;
}

export interface IChatRequestFileEntry extends IBaseChatRequestVariableEntry {
	kind: 'file';
}

export const enum OmittedState {
	NotOmitted,
	Partial,
	Full,
	ImageLimitExceeded,
}

const CLAUDE_MESSAGES_MAX_IMAGES_PER_REQUEST = 20;
const GEMINI_MAX_IMAGES_PER_REQUEST = 10;

export function getImageAttachmentLimit(model: Pick<ILanguageModelChatMetadata, 'family'> | undefined): number | undefined {
	if (!model) {
		return undefined;
	}

	const family = model.family.toLowerCase();
	if (family.startsWith('gemini')) {
		return GEMINI_MAX_IMAGES_PER_REQUEST;
	}

	if (family.startsWith('claude') || family.startsWith('anthropic')) {
		return CLAUDE_MESSAGES_MAX_IMAGES_PER_REQUEST;
	}

	return undefined;
}

export interface IChatRequestToolEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'tool';
}

export interface IChatRequestToolSetEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'toolset';
	readonly value: IChatRequestToolEntry[];
}

export type ChatRequestToolReferenceEntry = IChatRequestToolEntry | IChatRequestToolSetEntry;

export interface StringChatContextValue {
	value?: string;
	name?: string;
	modelDescription?: string;
	iconPath?: ChatContextIconPath;
	uri: URI;
	resourceUri?: URI;
	tooltip?: IMarkdownString;
	readonly commandId?: string;
	readonly handle: number;
}

export interface IChatRequestImplicitVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'implicit';
	readonly isFile: true;
	readonly value: URI | Location | StringChatContextValue | undefined;
	readonly uri: URI | undefined;
	readonly isSelection: boolean;
	enabled: boolean;
}

export interface IChatRequestStringVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'string';
	readonly value: string | undefined;
	readonly modelDescription?: string;
	readonly iconPath?: ChatContextIconPath;
	readonly uri: URI;
	readonly resourceUri?: URI;
	readonly tooltip?: IMarkdownString;
	readonly commandId?: string;
	readonly handle: number;
}

export interface IChatRequestTranscriptContextVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'transcriptContext';
	readonly value: string;
	readonly uri: URI;
	readonly tooltip?: string;
	readonly readyMessage?: string;
}

export interface IChatRequestWorkspaceVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'workspace';
	readonly value: string;
	readonly modelDescription?: string;
}


export interface IChatRequestPasteVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'paste';
	readonly code: string;
	readonly language: string;
	readonly pastedLines: string;

	readonly fileName: string;

	readonly copiedFrom: {
		readonly uri: URI;
		readonly range: IRange;
	} | undefined;
}

export function toPasteVariableEntry(
	name: string,
	code: string,
	options?: {
		readonly id?: string;
		readonly icon?: ThemeIcon;
		readonly language?: string;
		readonly fileName?: string;
		readonly pastedLines?: string;
		readonly _meta?: Record<string, unknown>;
	}
): IChatRequestPasteVariableEntry {
	const language = options?.language ?? 'markdown';
	const fileName = options?.fileName ?? name;
	const pastedLines = options?.pastedLines ?? name;
	return {
		kind: 'paste',
		id: options?.id ?? `chat-paste-${generateUuid()}`,
		name,
		icon: options?.icon,
		value: code,
		code,
		language,
		pastedLines,
		fileName,
		copiedFrom: undefined,
		_meta: {
			...options?._meta,
			[ChatPasteAttachmentMetadata.Kind]: 'paste',
			[ChatPasteAttachmentMetadata.Language]: language,
			[ChatPasteAttachmentMetadata.FileName]: fileName,
			[ChatPasteAttachmentMetadata.PastedLines]: pastedLines,
		},
	};
}

export function restorePasteVariableEntryFromAttachment(attachment: IRestorablePasteAttachment): IChatRequestPasteVariableEntry | undefined {
	const modelRepresentation = attachment.modelRepresentation;
	if (typeof modelRepresentation !== 'string' || attachment._meta?.[ChatPasteAttachmentMetadata.Kind] !== 'paste') {
		return undefined;
	}

	const stringMetadata = (key: string, fallback: string): string => {
		const value = attachment._meta?.[key];
		return typeof value === 'string' ? value : fallback;
	};
	return toPasteVariableEntry(attachment.label, modelRepresentation, {
		language: stringMetadata(ChatPasteAttachmentMetadata.Language, 'markdown'),
		fileName: stringMetadata(ChatPasteAttachmentMetadata.FileName, attachment.label),
		pastedLines: stringMetadata(ChatPasteAttachmentMetadata.PastedLines, attachment.label),
		_meta: attachment._meta,
	});
}

export interface ISymbolVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'symbol';
	readonly value: Location;
	readonly symbolKind: SymbolKind;
}

export interface ICommandResultVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'command';
}

export interface IImageVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'image';
	readonly isPasted?: boolean;
	readonly isURL?: boolean;
	readonly mimeType?: string;
}

export interface INotebookOutputVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'notebookOutput';
	readonly outputIndex?: number;
	readonly mimeType?: string;
}

export interface IDiagnosticVariableEntryFilterData {
	readonly owner?: string;
	readonly problemMessage?: string;
	readonly filterUri?: URI;
	readonly filterSeverity?: MarkerSeverity;
	readonly filterRange?: IRange;
}



export namespace IDiagnosticVariableEntryFilterData {
	export const icon = Codicon.error;

	export function fromMarker(marker: IMarker): IDiagnosticVariableEntryFilterData {
		return {
			filterUri: marker.resource,
			owner: marker.owner,
			problemMessage: marker.message,
			filterRange: { startLineNumber: marker.startLineNumber, endLineNumber: marker.endLineNumber, startColumn: marker.startColumn, endColumn: marker.endColumn }
		};
	}

	export function toEntry(data: IDiagnosticVariableEntryFilterData): IDiagnosticVariableEntry {
		return {
			id: id(data),
			name: label(data),
			icon,
			value: data,
			kind: 'diagnostic',
			...data,
		};
	}

	export function id(data: IDiagnosticVariableEntryFilterData) {
		return [data.filterUri, data.owner, data.filterSeverity, data.filterRange?.startLineNumber, data.filterRange?.startColumn].join(':');
	}

	export function label(data: IDiagnosticVariableEntryFilterData) {
		const enum TrimThreshold {
			MaxChars = 30,
			MaxSpaceLookback = 10,
		}
		if (data.problemMessage) {
			if (data.problemMessage.length < TrimThreshold.MaxChars) {
				return data.problemMessage;
			}

			const lastSpace = data.problemMessage.lastIndexOf(' ', TrimThreshold.MaxChars);
			if (lastSpace === -1 || lastSpace + TrimThreshold.MaxSpaceLookback < TrimThreshold.MaxChars) {
				return data.problemMessage.substring(0, TrimThreshold.MaxChars) + '…';
			}
			return data.problemMessage.substring(0, lastSpace) + '…';
		}
		let labelStr = localize('chat.attachment.problems.all', "All Problems");
		if (data.filterUri) {
			labelStr = localize('chat.attachment.problems.inFile', "Problems in {0}", basename(data.filterUri));
		}

		return labelStr;
	}
}

export interface IDiagnosticVariableEntry extends IBaseChatRequestVariableEntry, IDiagnosticVariableEntryFilterData {
	readonly kind: 'diagnostic';
}

export interface IElementAncestorData {
	readonly tagName: string;
	readonly id?: string;
	readonly classNames?: string[];
}

export interface IElementVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'element';
	readonly value: string;
	readonly imageData?: IChatRequestVariableValue;
	readonly imageMimeType?: string;
	readonly ancestors?: IElementAncestorData[];
	readonly attributes?: Record<string, string>;
	readonly computedStyles?: Record<string, string>;
	readonly dimensions?: { readonly top: number; readonly left: number; readonly width: number; readonly height: number };
	readonly innerText?: string;
}

export interface IPromptFileVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'promptFile';
	readonly value: URI;
	readonly isRoot: boolean;
	readonly originLabel?: string;
	readonly modelDescription: string;
	readonly automaticallyAdded: boolean;
	readonly toolReferences?: readonly ChatRequestToolReferenceEntry[];
}

export interface IPromptTextVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'promptText';
	readonly value: string;
	readonly settingId?: string;
	readonly modelDescription: string;
	readonly automaticallyAdded: boolean;
	readonly toolReferences?: readonly ChatRequestToolReferenceEntry[];
}

export interface ISCMHistoryItemVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'scmHistoryItem';
	readonly value: URI;
	readonly historyItem: ISCMHistoryItem;
}

export interface ISCMHistoryItemChangeVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'scmHistoryItemChange';
	readonly value: URI;
	readonly historyItem: ISCMHistoryItem;
}

export interface ISCMHistoryItemChangeRangeVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'scmHistoryItemChangeRange';
	readonly value: URI;
	readonly historyItemChangeStart: {
		readonly uri: URI;
		readonly historyItem: ISCMHistoryItem;
	};
	readonly historyItemChangeEnd: {
		readonly uri: URI;
		readonly historyItem: ISCMHistoryItem;
	};
}

export interface ITerminalVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'terminalCommand';
	readonly value: string;
	readonly resource: URI;
	readonly command: string;
	readonly output?: string;
	readonly exitCode?: number;
}

export interface IDebugVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'debugVariable';
	readonly value: string;
	readonly expression: string;
	readonly type?: string;
}

export interface IAgentFeedbackVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'agentFeedback';
	readonly sessionResource: URI;
	readonly annotationsResource?: URI;
	readonly feedbackItems: ReadonlyArray<{
		readonly id: string;
		readonly text: string;
		readonly resourceUri: URI;
		readonly range: IRange;
		readonly codeSelection?: string;
		readonly diffHunks?: string;
		readonly sourcePRReviewCommentId?: string;
		readonly sourcePullRequest?: IFeedbackPullRequest;
		readonly replies?: readonly string[];
	}>;
}

export interface IChatRequestDebugEventsVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'debugEvents';
	readonly snapshotTime: number;
	readonly sessionResource: URI;
}

export interface IChatRequestSessionReferenceVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'sessionReference';
	readonly value: URI;
}

export interface IBrowserViewVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'browserView';
	readonly value: URI;
	readonly browserId: string;
}

export function isBrowserViewVariableEntry(entry: IChatRequestVariableEntry): entry is IBrowserViewVariableEntry {
	return entry.kind === 'browserView';
}

export interface IChatRequestChatReferenceVariableEntry extends IBaseChatRequestVariableEntry {
	readonly kind: 'chatReference';
	readonly value: URI;
	readonly endTurn?: string;
}

export function isChatReferenceVariableEntry(entry: IChatRequestVariableEntry): entry is IChatRequestChatReferenceVariableEntry {
	return entry.kind === 'chatReference';
}

export function chatReferenceVariableEntryId(chatResource: URI, endTurn?: string): string {
	return endTurn === undefined
		? `agent-host-chat:${chatResource.toString()}`
		: `agent-host-chat:${chatResource.toString()}\u0000${endTurn}`;
}

export function createChatReferenceVariableEntry(chatResource: URI, endTurn: string | undefined, title: string, _meta?: Record<string, unknown>, range?: IOffsetRange): IChatRequestChatReferenceVariableEntry {
	return {
		kind: 'chatReference',
		id: chatReferenceVariableEntryId(chatResource, endTurn),
		name: title,
		value: chatResource,
		endTurn,
		range,
		_meta,
	};
}

export interface IChatReferenceDynamicVariableValue {
	readonly $mid: 'agentHostChatReference';
	readonly chatResource: string;
	readonly endTurn?: string;
}

export function toChatReferenceDynamicVariableValue(chatResource: URI, endTurn?: string): IChatReferenceDynamicVariableValue {
	return endTurn === undefined
		? { $mid: 'agentHostChatReference', chatResource: chatResource.toString() }
		: { $mid: 'agentHostChatReference', chatResource: chatResource.toString(), endTurn };
}

export function isChatReferenceDynamicVariableValue(value: IChatRequestVariableValue): value is IChatReferenceDynamicVariableValue {
	return typeof value === 'object' && value !== null && (value as { $mid?: unknown }).$mid === 'agentHostChatReference';
}

export function chatReferenceVariableEntryFromDynamicValue(value: IChatReferenceDynamicVariableValue, id: string, name: string, range: IOffsetRange | undefined, _meta: Record<string, unknown> | undefined): IChatRequestChatReferenceVariableEntry | undefined {
	let chatResource: URI;
	try {
		chatResource = URI.parse(value.chatResource);
	} catch {
		return undefined;
	}
	return {
		kind: 'chatReference',
		id,
		name,
		value: chatResource,
		endTurn: value.endTurn,
		range,
		_meta,
	};
}

export type IChatRequestVariableEntry = IGenericChatRequestVariableEntry | IChatRequestImplicitVariableEntry | IChatRequestPasteVariableEntry
	| ISymbolVariableEntry | ICommandResultVariableEntry | IDiagnosticVariableEntry | IImageVariableEntry
	| IChatRequestToolEntry | IChatRequestToolSetEntry
	| IChatRequestDirectoryEntry | IChatRequestFileEntry | INotebookOutputVariableEntry | IElementVariableEntry
	| IPromptFileVariableEntry | IPromptTextVariableEntry
	| ISCMHistoryItemVariableEntry | ISCMHistoryItemChangeVariableEntry | ISCMHistoryItemChangeRangeVariableEntry | ITerminalVariableEntry
	| IChatRequestStringVariableEntry | IChatRequestWorkspaceVariableEntry | IDebugVariableEntry | IAgentFeedbackVariableEntry
	| IChatRequestDebugEventsVariableEntry | IChatRequestSessionReferenceVariableEntry | IBrowserViewVariableEntry | IChatRequestChatReferenceVariableEntry
	| IChatRequestTranscriptContextVariableEntry;

export namespace IChatRequestVariableEntry {

	export function toUri(entry: IChatRequestVariableEntry): URI | undefined {
		return URI.isUri(entry.value)
			? entry.value
			: isLocation(entry.value)
				? entry.value.uri
				: undefined;
	}

	export function toExport(v: IChatRequestVariableEntry): IChatRequestVariableEntry {
		if (v.value instanceof Uint8Array) {
			const dup: Mutable<IChatRequestVariableEntry> = { ...v };
			dup.value = { $base64: encodeBase64(VSBuffer.wrap(v.value)) };
			return dup;
		}
		if (isElementVariableEntry(v) && v.imageData instanceof Uint8Array) {
			return {
				...v,
				imageData: { $base64: encodeBase64(VSBuffer.wrap(v.imageData)) }
			};
		}

		return v;
	}

	export function fromExport(v: IChatRequestVariableEntry): IChatRequestVariableEntry {
		// eslint-disable-next-line local/code-no-in-operator
		if (v && 'values' in v && Array.isArray(v.values)) {
			return {
				kind: 'generic',
				id: v.id ?? '',
				name: v.name,
				value: v.values[0]?.value,
				range: v.range,
				modelDescription: v.modelDescription,
				references: v.references
			};
		} else {
			// eslint-disable-next-line local/code-no-in-operator
			if (v.value && typeof v.value === 'object' && '$base64' in v.value && typeof v.value.$base64 === 'string') {
				const dup: Mutable<IChatRequestVariableEntry> = { ...v };
				dup.value = decodeBase64(v.value.$base64).buffer;
				return dup;
			}
			// eslint-disable-next-line local/code-no-in-operator
			if (isElementVariableEntry(v) && v.imageData && typeof v.imageData === 'object' && '$base64' in v.imageData && typeof v.imageData.$base64 === 'string') {
				return {
					...v,
					imageData: decodeBase64(v.imageData.$base64).buffer
				};
			}

			return v;
		}
	}
}

export function isImplicitVariableEntry(obj: IChatRequestVariableEntry): obj is IChatRequestImplicitVariableEntry {
	return obj.kind === 'implicit';
}

export function isStringVariableEntry(obj: IChatRequestVariableEntry): obj is IChatRequestStringVariableEntry {
	return obj.kind === 'string';
}

export function isChatTranscriptContextVariableEntry(obj: IChatRequestVariableEntry): obj is IChatRequestTranscriptContextVariableEntry {
	return obj.kind === 'transcriptContext';
}

export function toChatTranscriptContextAttachmentMeta(entry: IChatRequestTranscriptContextVariableEntry): Record<string, unknown> {
	return {
		...entry._meta,
		[ChatTranscriptContextMetadataKey]: {
			uri: entry.uri.toString(),
			iconId: entry.icon?.id,
			tooltip: entry.tooltip,
			fullName: entry.fullName,
			readyMessage: entry.readyMessage,
		},
	};
}

export function restoreChatTranscriptContextVariableEntry(label: string, value: string, meta: Record<string, unknown> | undefined): IChatRequestTranscriptContextVariableEntry | undefined {
	const raw = meta?.[ChatTranscriptContextMetadataKey];
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return undefined;
	}
	const record = raw as Record<string, unknown>;
	if (typeof record.uri !== 'string') {
		return undefined;
	}
	return {
		kind: 'transcriptContext',
		id: generateUuid(),
		name: label,
		...(typeof record.fullName === 'string' ? { fullName: record.fullName } : {}),
		...(typeof record.iconId === 'string' ? { icon: ThemeIcon.fromId(record.iconId) } : {}),
		...(typeof record.tooltip === 'string' ? { tooltip: record.tooltip } : {}),
		...(typeof record.readyMessage === 'string' ? { readyMessage: record.readyMessage } : {}),
		value,
		uri: URI.parse(record.uri),
		_meta: meta,
	};
}

export function isTerminalVariableEntry(obj: IChatRequestVariableEntry): obj is ITerminalVariableEntry {
	return obj.kind === 'terminalCommand';
}

export function isDebugVariableEntry(obj: IChatRequestVariableEntry): obj is IDebugVariableEntry {
	return obj.kind === 'debugVariable';
}

export function isAgentFeedbackVariableEntry(obj: IChatRequestVariableEntry): obj is IAgentFeedbackVariableEntry {
	return obj.kind === 'agentFeedback';
}

export function isPasteVariableEntry(obj: IChatRequestVariableEntry): obj is IChatRequestPasteVariableEntry {
	return obj.kind === 'paste';
}

export function isPastedTextArtifact(obj: IChatRequestVariableEntry): obj is IChatRequestPasteVariableEntry {
	return isPasteVariableEntry(obj) && obj._meta?.[ChatPasteAttachmentMetadata.TextArtifact] === true;
}

export function isWorkspaceVariableEntry(obj: IChatRequestVariableEntry): obj is IChatRequestWorkspaceVariableEntry {
	return obj.kind === 'workspace';
}

export function isImageVariableEntry(obj: IChatRequestVariableEntry): obj is IImageVariableEntry {
	return obj.kind === 'image';
}

export function isExplicitFileOrImageVariableEntry(obj: IChatRequestVariableEntry): obj is IChatRequestFileEntry | IChatRequestDirectoryEntry | IImageVariableEntry {
	return obj.kind === 'file' || obj.kind === 'directory' || obj.kind === 'image';
}

export function getExplicitFileOrImageAttachmentSummary(entries: readonly IChatRequestVariableEntry[]): string | undefined {
	const fileOrImageEntries = entries.filter(isExplicitFileOrImageVariableEntry);
	if (!fileOrImageEntries.length) {
		return undefined;
	}

	if (fileOrImageEntries.every(isImageVariableEntry)) {
		return fileOrImageEntries.length === 1
			? localize('chat.attachmentSummary.image.one', "Attached 1 image")
			: localize('chat.attachmentSummary.image.many', "Attached {0} images", fileOrImageEntries.length);
	}

	return fileOrImageEntries.length === 1
		? localize('chat.attachmentSummary.file.one', "Attached 1 file")
		: localize('chat.attachmentSummary.file.many', "Attached {0} files", fileOrImageEntries.length);
}

export function isNotebookOutputVariableEntry(obj: IChatRequestVariableEntry): obj is INotebookOutputVariableEntry {
	return obj.kind === 'notebookOutput';
}

export function isElementVariableEntry(obj: IChatRequestVariableEntry): obj is IElementVariableEntry {
	return obj.kind === 'element';
}

export function isDiagnosticsVariableEntry(obj: IChatRequestVariableEntry): obj is IDiagnosticVariableEntry {
	return obj.kind === 'diagnostic';
}

export function isChatRequestFileEntry(obj: IChatRequestVariableEntry): obj is IChatRequestFileEntry {
	return obj.kind === 'file';
}

export function isPromptFileVariableEntry(obj: IChatRequestVariableEntry): obj is IPromptFileVariableEntry {
	return obj.kind === 'promptFile';
}

export function isPromptTextVariableEntry(obj: IChatRequestVariableEntry): obj is IPromptTextVariableEntry {
	return obj.kind === 'promptText';
}

export function isChatRequestVariableEntry(obj: unknown): obj is IChatRequestVariableEntry {
	const entry = obj as IChatRequestVariableEntry;
	return typeof entry === 'object' &&
		entry !== null &&
		typeof entry.id === 'string' &&
		typeof entry.name === 'string';
}

export function isSCMHistoryItemVariableEntry(obj: IChatRequestVariableEntry): obj is ISCMHistoryItemVariableEntry {
	return obj.kind === 'scmHistoryItem';
}

export function isSCMHistoryItemChangeVariableEntry(obj: IChatRequestVariableEntry): obj is ISCMHistoryItemChangeVariableEntry {
	return obj.kind === 'scmHistoryItemChange';
}

export function isSCMHistoryItemChangeRangeVariableEntry(obj: IChatRequestVariableEntry): obj is ISCMHistoryItemChangeRangeVariableEntry {
	return obj.kind === 'scmHistoryItemChangeRange';
}

export function isStringImplicitContextValue(value: unknown): value is StringChatContextValue {
	const asStringImplicitContextValue = value as Partial<StringChatContextValue>;
	return (
		typeof asStringImplicitContextValue === 'object' &&
		asStringImplicitContextValue !== null &&
		(typeof asStringImplicitContextValue.value === 'string' || typeof asStringImplicitContextValue.value === 'undefined') &&
		(typeof asStringImplicitContextValue.name === 'string' || typeof asStringImplicitContextValue.name === 'undefined') &&
		(asStringImplicitContextValue.resourceUri === undefined || URI.isUri(asStringImplicitContextValue.resourceUri)) &&
		(typeof asStringImplicitContextValue.name === 'string' || URI.isUri(asStringImplicitContextValue.resourceUri)) &&
		(asStringImplicitContextValue.iconPath === undefined || isChatContextIconPath(asStringImplicitContextValue.iconPath)) &&
		URI.isUri(asStringImplicitContextValue.uri) &&
		typeof asStringImplicitContextValue.handle === 'number'
	);
}

export enum PromptFileVariableKind {
	Instruction = 'vscode.instructions.file.root',
	InstructionReference = `vscode.instructions.file.reference`,
	PromptFile = 'vscode.prompt.file',
}

export function toPromptFileVariableEntry(uri: URI, kind: PromptFileVariableKind, originLabel?: string, automaticallyAdded = false, toolReferences?: ChatRequestToolReferenceEntry[]): IPromptFileVariableEntry {
	return {
		id: `${kind}__${uri.toString()}`,
		name: `prompt:${basename(uri)}`,
		value: uri,
		kind: 'promptFile',
		modelDescription: 'Prompt instructions file',
		isRoot: kind !== PromptFileVariableKind.InstructionReference,
		originLabel,
		toolReferences,
		automaticallyAdded
	};
}

enum PromptTextVariableKind {
	CustomizationsIndex = 'vscode.customizations.index',
}

export function toPromptTextVariableEntry(content: string, automaticallyAdded = false, toolReferences?: ChatRequestToolReferenceEntry[]): IPromptTextVariableEntry {
	return {
		id: PromptTextVariableKind.CustomizationsIndex,
		name: `prompt:customizationsIndex`,
		value: content,
		kind: 'promptText',
		modelDescription: 'Chat customizations index',
		automaticallyAdded,
		toolReferences
	};
}

export function toFileVariableEntry(uri: URI, range?: IRange): IChatRequestFileEntry {
	return {
		kind: 'file',
		value: range ? { uri, range } : uri,
		id: uri.toString() + (range?.toString() ?? ''),
		name: basename(uri),
	};
}

export function toToolVariableEntry(entry: IToolData, range?: IOffsetRange): IChatRequestToolEntry {
	return {
		kind: 'tool',
		id: entry.id,
		icon: ThemeIcon.isThemeIcon(entry.icon) ? entry.icon : undefined,
		name: entry.displayName,
		value: undefined,
		range
	};
}

export function toToolSetVariableEntry(entry: IToolSet, range?: IOffsetRange): IChatRequestToolSetEntry {
	return {
		kind: 'toolset',
		id: entry.id,
		icon: entry.icon,
		name: entry.referenceName,
		value: Array.from(entry.getTools()).map(t => toToolVariableEntry(t)),
		range
	};
}

export class ChatRequestVariableSet {
	private _ids = new Set<string>();
	private _entries: IChatRequestVariableEntry[] = [];

	constructor(entries?: IChatRequestVariableEntry[]) {
		if (entries) {
			this.add(...entries);
		}
	}

	public add(...entry: IChatRequestVariableEntry[]): void {
		for (const e of entry) {
			if (!this._ids.has(e.id)) {
				this._ids.add(e.id);
				this._entries.push(e);
			}
		}
	}

	public insertFirst(entry: IChatRequestVariableEntry): void {
		if (!this._ids.has(entry.id)) {
			this._ids.add(entry.id);
			this._entries.unshift(entry);
		}
	}

	public remove(entry: IChatRequestVariableEntry): void {
		this._ids.delete(entry.id);
		this._entries = this._entries.filter(e => e.id !== entry.id);
	}

	public has(entry: IChatRequestVariableEntry): boolean {
		return this._ids.has(entry.id);
	}

	public asArray(): IChatRequestVariableEntry[] {
		return this._entries.slice(0);
	}

	public get length(): number {
		return this._entries.length;
	}
}

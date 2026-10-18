/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { distinct } from '../../../../base/common/arrays.js';
import { decodeBase64, encodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { hasKey, type Mutable } from '../../../../base/common/types.js';
import { URI as ResourceURI } from '../../../../base/common/uri.js';
import type { IProductService } from '../../../product/common/productService.js';
import { isAgentWorkspaceContinuationMessage } from '../meta/agentWorkspaceContinuationMeta.js';
import { readToolCallMeta } from '../meta/agentToolCallMeta.js';
import { readLegacyTurnError } from './legacyProtocolCompatibility.js';
import {
	MessageKind,
	ResponsePartKind,
	SessionStatus,
	ToolCallStatus,
	TurnState,
	SessionLifecycle,
	TerminalState,
	ToolResultContentType,
	ToolResultFileEditContent,
	ChatOriginKind,
	ChatInteractivity,
	type ActiveTurn,
	type ChangesetState,
	type ChatState,
	type ChatSummary,
	type ErrorInfo,
	type ErrorResponsePart,
	type PendingMessage,
	type Turn,
	type AnnotationsState,
	type AutomationState,
	type AutomationRunState,
	type URI as ProtocolURI,
	type RootState,
	type SessionState,
	type SessionSummary,
	type TextRange,
	type ToolCallCancelledState,
	type ToolCallCompletedState,
	type ToolCallResult,
	type ToolCallState,
	type ToolInput,
	type ToolResultContent,
	type ToolResultSubagentContent,
	type ToolResultTextContent,
	type UsageInfo,
	type Message,
} from './protocol/state.js';

export {
	ChangesetOperationScope, ChangesetOperationStatus, ChangesetStatus, CustomizationLoadStatus,
	CustomizationType, MessageAttachmentKind, MessageKind,
	PendingMessageKind,
	PolicyState,
	ResponsePartKind,
	ChatInteractivity,
	ChatOriginKind,
	SessionLifecycle,
	SessionStatus, ToolCallCancellationReason, ToolCallConfirmationReason, ToolCallContributorKind, ToolCallRiskAssessmentKind, ToolCallRiskAssessmentStatus, ToolCallStatus,
	ToolResultContentType,
	TurnState, type ActiveTurn, type AgentCustomization, type AgentCapabilities, type AgentInfo, type AgentSelection, type Annotation, type AnnotationEntry, type AnnotationOrigin, type AnnotationsState, type AnnotationsSummary, type Changeset, type ChangesetFile,
	type ChangesetOperation, type ChangesetState, type ChatState, type ChatSummary, type ChatOrigin, type ChildCustomization, type ClientPluginCustomization, type ConfigPropertySchema,
	type ConfigSchema,
	type ContentRef, type Customization, type CustomizationDegradedState,
	type CustomizationErrorState, type CustomizationLoadedState, type CustomizationLoadingState, type CustomizationLoadState, type DirectoryCustomization, type ErrorInfo, type HookCustomization, type FileEdit as ISessionFileDiff, type ToolResultEmbeddedResourceContent as IToolResultBinaryContent, type MarkdownResponsePart, type McpServerCustomization, type MessageAttachment,
	type MessageResourceAttachment, type MessageEmbeddedResourceAttachment, type MessageAnnotationsAttachment, type MessageChatAttachment, type ModelSelection, type PendingMessage, type PluginCustomization, type ProjectInfo, type PromptCustomization, type ReasoningResponsePart,
	type ErrorResponsePart, type ResponsePart,
	type RootState, type RuleCustomization, type SessionActiveClient,
	type AutomationState, type AutomationRunState,
	type SessionConfigState,
	type SessionModelInfo,
	type SessionState,
	type SessionSummary, type SkillCustomization, type Snapshot, type StringOrMarkdown, type TerminalState, type TextRange,
	type ToolAnnotations,
	type ToolCallCancelledState,
	type ToolCallCompletedState,
	type ToolCallPendingConfirmationState,
	type ToolCallPendingResultConfirmationState,
	type ToolCallResponsePart,
	type ToolCallResult,
	type ToolCallRiskAssessment,
	type ToolCallRiskAssessmentCompleteState,
	type ToolCallRiskAssessmentLoadingState,
	type ToolCallRunningState,
	type ToolCallState,
	type ToolCallStreamingState,
	type ToolCallContributor,
	type ToolDefinition, type ToolInput, type ToolResultContent,
	type ToolResultFileEditContent,
	type TerminalCommandResult,
	type ToolResultSubagentContent,
	type ToolResultTerminalContent,
	type ToolResultTextContent,
	type Turn, type URI, type UsageInfo,
	type Message
} from './protocol/state.js';

export function getErrorResponsePart(turn: Turn | ActiveTurn | undefined): ErrorResponsePart | undefined {
	if (!turn) {
		return undefined;
	}
	const part = turn.responseParts.at(-1);
	return part?.kind === ResponsePartKind.Error ? part : undefined;
}

export function createErrorResponsePart(error: ErrorInfo, resumable = false): ErrorResponsePart {
	return {
		kind: ResponsePartKind.Error,
		error,
		...(resumable ? { resumable: true } : {}),
	};
}

export function mergeLogicalTurnUsage(previous: UsageInfo | undefined, current: UsageInfo | undefined): UsageInfo | undefined {
	if (!previous) {
		return current;
	}
	if (!current) {
		return previous;
	}

	const previousMeta = readUsageInfoMeta(previous);
	const currentMeta = readUsageInfoMeta(current);
	const cost = sumDefined(previousMeta.cost, currentMeta.cost);
	const totalNanoAiu = sumDefined(previousMeta.copilotUsage?.totalNanoAiu, currentMeta.copilotUsage?.totalNanoAiu);
	const turnTokenTotals = mergeTurnTokenTotals(previousMeta.turnTokenTotals, currentMeta.turnTokenTotals);
	const directTotalNanoAiu = sumDefined(previousMeta.directCopilotUsage?.totalNanoAiu, currentMeta.directCopilotUsage?.totalNanoAiu);
	const directTurnTokenTotals = mergeTurnTokenTotals(previousMeta.directTurnTokenTotals, currentMeta.directTurnTokenTotals);
	const meta = previous._meta !== undefined || current._meta !== undefined ? {
		...previous._meta,
		...current._meta,
		...(cost !== undefined ? { cost } : {}),
		...(previousMeta.copilotUsage || currentMeta.copilotUsage ? {
			copilotUsage: {
				...previousMeta.copilotUsage,
				...currentMeta.copilotUsage,
				...(totalNanoAiu !== undefined ? { totalNanoAiu } : {}),
			},
		} : {}),
		...(turnTokenTotals ? { turnTokenTotals } : {}),
		...(directTotalNanoAiu !== undefined ? { directCopilotUsage: { totalNanoAiu: directTotalNanoAiu } } : {}),
		...(directTurnTokenTotals ? { directTurnTokenTotals } : {}),
	} : undefined;

	return {
		...previous,
		...current,
		model: current.model ?? previous.model,
		...(meta ? { _meta: meta } : {}),
	};
}

function sumDefined(first: number | undefined, second: number | undefined): number | undefined {
	return first === undefined ? second : second === undefined ? first : first + second;
}

function mergeTurnTokenTotals(previous: UsageInfoMeta['turnTokenTotals'], current: UsageInfoMeta['turnTokenTotals']): UsageInfoMeta['turnTokenTotals'] {
	if (!previous && !current) {
		return undefined;
	}
	const totals = new Map<string, ITurnTokenTotal>();
	for (const total of [...previous ?? [], ...current ?? []]) {
		const existing = totals.get(total.model);
		totals.set(total.model, existing ? {
			model: total.model,
			inputTokens: existing.inputTokens + total.inputTokens,
			cachedTokens: existing.cachedTokens + total.cachedTokens,
			outputTokens: existing.outputTokens + total.outputTokens,
		} : { ...total });
	}
	return [...totals.values()];
}

export interface UsageInfoMeta {
	cost?: number;
	autoModeResolved?: IAutoModeResolvedInfo;
	copilotUsage?: {
		totalNanoAiu?: number;
		sessionTotalNanoAiu?: number;
		[key: string]: unknown;
	};
	quotaSnapshots?: {
		[quotaType: string]: {
			readonly isUnlimitedEntitlement?: boolean;
			readonly entitlementRequests?: number;
			readonly usedRequests?: number;
			readonly remainingPercentage?: number;
			readonly overage?: number;
			readonly overageAllowedWithExhaustedQuota?: boolean;
			readonly resetDate?: string;
			readonly tokenBasedBilling?: boolean;
			readonly overageEntitlement?: number;
		} | undefined;
	};
	contextAttribution?: IContextAttributionData;
	turnTokenTotals?: readonly ITurnTokenTotal[];
	directTurnTokenTotals?: readonly ITurnTokenTotal[];
	directCopilotUsage?: {
		readonly totalNanoAiu?: number;
	};
	[key: string]: unknown;
}

export const AHP_AUTOMATIONS_SCHEME = 'ahp-automations';
export const AUTOMATION_CATALOG_URI = `${AHP_AUTOMATIONS_SCHEME}://`;

export function isAhpAutomationCatalogChannel(uri: string): boolean {
	if (uri === AUTOMATION_CATALOG_URI) {
		return true;
	}
	try {
		return ResourceURI.parse(uri).scheme === AHP_AUTOMATIONS_SCHEME;
	} catch {
		return false;
	}
}

export function isAhpAutomationRunChannel(uri: string): boolean {
	try {
		return ResourceURI.parse(uri).scheme === 'ahp-automation-run';
	} catch {
		return false;
	}
}

const MESSAGE_HIDDEN_FROM_TRANSCRIPT_META_KEY = 'vscode.chat.hiddenFromTranscript';
const MESSAGE_HIDDEN_FROM_TRANSCRIPT_PREFIX = '<!-- vscode-hidden-from-transcript -->\n';
const MESSAGE_REQUEST_HIDDEN_FROM_TRANSCRIPT_META_KEY = 'vscode.chat.requestHiddenFromTranscript';
const MESSAGE_REQUEST_HIDDEN_FROM_TRANSCRIPT_PREFIX = '<!-- vscode-request-hidden-from-transcript -->\n';
const MESSAGE_SYSTEM_INITIATED_LABEL_META_KEY = 'vscode.chat.systemInitiatedLabel';

function readMessageMeta(message: Message): { readonly hiddenFromTranscript: boolean; readonly requestHiddenFromTranscript: boolean; readonly systemInitiatedLabel: string | undefined } {
	const meta = message._meta;
	const systemInitiatedLabel = meta?.[MESSAGE_SYSTEM_INITIATED_LABEL_META_KEY];
	const hiddenFromTranscript = meta?.[MESSAGE_HIDDEN_FROM_TRANSCRIPT_META_KEY] === true
		|| message.text.startsWith(MESSAGE_HIDDEN_FROM_TRANSCRIPT_PREFIX);
	return {
		hiddenFromTranscript,
		requestHiddenFromTranscript: meta?.[MESSAGE_REQUEST_HIDDEN_FROM_TRANSCRIPT_META_KEY] === true
			|| message.text.startsWith(MESSAGE_REQUEST_HIDDEN_FROM_TRANSCRIPT_PREFIX),
		systemInitiatedLabel: typeof systemInitiatedLabel === 'string' ? systemInitiatedLabel : undefined,
	};
}

export function isMessageHiddenFromTranscript(message: Message): boolean {
	return readMessageMeta(message).hiddenFromTranscript;
}

export function isMessageRequestHiddenFromTranscript(message: Message): boolean {
	return readMessageMeta(message).requestHiddenFromTranscript;
}

export function readMessageSystemInitiatedLabel(message: Message): string | undefined {
	return readMessageMeta(message).systemInitiatedLabel;
}

export function withMessageHiddenFromTranscript(message: Message, hidden: boolean | undefined): Message {
	if (!hidden) {
		return message;
	}
	return {
		...message,
		text: message.text.startsWith(MESSAGE_HIDDEN_FROM_TRANSCRIPT_PREFIX) ? message.text : MESSAGE_HIDDEN_FROM_TRANSCRIPT_PREFIX + message.text,
		_meta: {
			...message._meta,
			[MESSAGE_HIDDEN_FROM_TRANSCRIPT_META_KEY]: true,
		},
	};
}

export function withMessageRequestHiddenFromTranscript(message: Message, hidden: boolean | undefined): Message {
	if (!hidden || isMessageHiddenFromTranscript(message)) {
		return message;
	}
	return {
		...message,
		text: message.text.startsWith(MESSAGE_REQUEST_HIDDEN_FROM_TRANSCRIPT_PREFIX) ? message.text : MESSAGE_REQUEST_HIDDEN_FROM_TRANSCRIPT_PREFIX + message.text,
		_meta: {
			...message._meta,
			[MESSAGE_REQUEST_HIDDEN_FROM_TRANSCRIPT_META_KEY]: true,
		},
	};
}

export function withMessageSystemInitiatedLabel(message: Message, label: string): Message {
	return {
		...message,
		_meta: {
			...message._meta,
			[MESSAGE_SYSTEM_INITIATED_LABEL_META_KEY]: label,
		},
	};
}

export function isHostNoticeTurn(turn: { readonly message: Message }): boolean {
	return turn.message.origin.kind === MessageKind.SystemNotification
		&& (isMessageHiddenFromTranscript(turn.message) || isMessageRequestHiddenFromTranscript(turn.message))
		&& !isAgentWorkspaceContinuationMessage(turn.message);
}

export function lastAttributableTurnId(turns: readonly { readonly id: string; readonly message: Message }[] | undefined): string | undefined {
	if (!turns) {
		return undefined;
	}
	for (let i = turns.length - 1; i >= 0; i--) {
		if (!isHostNoticeTurn(turns[i])) {
			return turns[i].id;
		}
	}
	return undefined;
}

export interface ITurnTokenTotal {
	readonly model: string;
	readonly inputTokens: number;
	readonly cachedTokens: number;
	readonly outputTokens: number;
}

export interface IAutoModeResolvedInfo {
	readonly chosenModel: string;
	readonly reasoningBucket?: 'low' | 'medium' | 'high';
	readonly categoryScores?: Readonly<Record<string, number | undefined>>;
	readonly predictedLabel?: string;
	readonly confidence?: number;
	readonly candidateModels?: readonly string[];
}

export interface IContextAttributionData {
	readonly totalTokens: number;
	readonly entries: readonly IContextAttributionEntry[];
	readonly compactions: { readonly count: number };
}

export interface IContextAttributionEntry {
	readonly kind: string;
	readonly id: string;
	readonly label: string;
	readonly tokens: number;
	readonly parentId?: string;
	readonly attributes?: Readonly<Record<string, string | undefined>>;
}

type AccountQuotaSnapshot = NonNullable<NonNullable<UsageInfoMeta['quotaSnapshots']>[string]>;

function readAccountQuotaSnapshot(value: unknown): AccountQuotaSnapshot | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const raw = value as Record<string, unknown>;
	const snapshot: Mutable<AccountQuotaSnapshot> = {};
	if (typeof raw['isUnlimitedEntitlement'] === 'boolean') { snapshot.isUnlimitedEntitlement = raw['isUnlimitedEntitlement']; }
	if (typeof raw['entitlementRequests'] === 'number') { snapshot.entitlementRequests = raw['entitlementRequests']; }
	if (typeof raw['usedRequests'] === 'number') { snapshot.usedRequests = raw['usedRequests']; }
	if (typeof raw['remainingPercentage'] === 'number') { snapshot.remainingPercentage = raw['remainingPercentage']; }
	if (typeof raw['overage'] === 'number') { snapshot.overage = raw['overage']; }
	if (typeof raw['overageAllowedWithExhaustedQuota'] === 'boolean') { snapshot.overageAllowedWithExhaustedQuota = raw['overageAllowedWithExhaustedQuota']; }
	if (typeof raw['resetDate'] === 'string') { snapshot.resetDate = raw['resetDate']; }
	if (typeof raw['tokenBasedBilling'] === 'boolean') { snapshot.tokenBasedBilling = raw['tokenBasedBilling']; }
	if (typeof raw['overageEntitlement'] === 'number') { snapshot.overageEntitlement = raw['overageEntitlement']; }
	return snapshot;
}

export function readUsageInfoMeta(usage: UsageInfo | undefined): UsageInfoMeta {
	const meta = usage?._meta;
	if (!meta) {
		return {};
	}
	const result: Mutable<UsageInfoMeta> = {};
	if (typeof meta['cost'] === 'number') { result.cost = meta['cost']; }
	const autoModeResolved = readAutoModeResolvedInfo(meta['autoModeResolved']);
	if (autoModeResolved) { result.autoModeResolved = autoModeResolved; }
	const copilotUsage = meta['copilotUsage'];
	if (copilotUsage && typeof copilotUsage === 'object' && !Array.isArray(copilotUsage)) {
		const rawUsage = copilotUsage as Record<string, unknown>;
		const usage: Mutable<NonNullable<UsageInfoMeta['copilotUsage']>> = {};
		if (typeof rawUsage['totalNanoAiu'] === 'number') { usage.totalNanoAiu = rawUsage['totalNanoAiu']; }
		if (typeof rawUsage['sessionTotalNanoAiu'] === 'number') { usage.sessionTotalNanoAiu = rawUsage['sessionTotalNanoAiu']; }
		result.copilotUsage = usage;
	}
	const quotaSnapshots = meta['quotaSnapshots'];
	if (quotaSnapshots && typeof quotaSnapshots === 'object' && !Array.isArray(quotaSnapshots)) {
		const snapshots: Mutable<NonNullable<UsageInfoMeta['quotaSnapshots']>> = {};
		for (const [quotaType, value] of Object.entries(quotaSnapshots as Record<string, unknown>)) {
			snapshots[quotaType] = readAccountQuotaSnapshot(value);
		}
		result.quotaSnapshots = snapshots;
	}
	const contextAttribution = readContextAttribution(meta['contextAttribution']);
	if (contextAttribution) {
		result.contextAttribution = contextAttribution;
	}
	const turnTokenTotals = readTurnTokenTotals(meta['turnTokenTotals']);
	if (turnTokenTotals) {
		result.turnTokenTotals = turnTokenTotals;
	}
	const directTurnTokenTotals = readTurnTokenTotals(meta['directTurnTokenTotals']);
	if (directTurnTokenTotals) {
		result.directTurnTokenTotals = directTurnTokenTotals;
	}
	const directCopilotUsage = meta['directCopilotUsage'];
	if (directCopilotUsage && typeof directCopilotUsage === 'object' && !Array.isArray(directCopilotUsage)) {
		const totalNanoAiu = (directCopilotUsage as Record<string, unknown>)['totalNanoAiu'];
		if (typeof totalNanoAiu === 'number') {
			result.directCopilotUsage = { totalNanoAiu };
		}
	}
	return result;
}

function readTurnTokenTotals(value: unknown): readonly ITurnTokenTotal[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const totals: ITurnTokenTotal[] = [];
	for (const item of value) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			continue;
		}
		const raw = item as Record<string, unknown>;
		if (typeof raw['model'] !== 'string' || !raw['model']
			|| !isTokenCount(raw['inputTokens'])
			|| !isTokenCount(raw['cachedTokens'])
			|| !isTokenCount(raw['outputTokens'])
		) {
			continue;
		}
		totals.push({
			model: raw['model'],
			inputTokens: raw['inputTokens'],
			cachedTokens: raw['cachedTokens'],
			outputTokens: raw['outputTokens'],
		});
	}
	return totals.length > 0 ? totals : undefined;
}

function isTokenCount(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function hasReportedUsage(usage: UsageInfo | undefined): boolean {
	if (!usage) {
		return false;
	}
	if (typeof usage.inputTokens === 'number' || typeof usage.outputTokens === 'number') {
		return true;
	}
	const meta = readUsageInfoMeta(usage);
	return (typeof meta.copilotUsage?.totalNanoAiu === 'number' && meta.copilotUsage.totalNanoAiu >= 0)
		|| (typeof meta.copilotUsage?.sessionTotalNanoAiu === 'number' && meta.copilotUsage.sessionTotalNanoAiu >= 0)
		|| (typeof meta.cost === 'number' && meta.cost >= 0);
}

function readAutoModeResolvedInfo(value: unknown): IAutoModeResolvedInfo | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const raw = value as Record<string, unknown>;
	if (typeof raw['chosenModel'] !== 'string') {
		return undefined;
	}
	const result: Mutable<IAutoModeResolvedInfo> = { chosenModel: raw['chosenModel'] };
	const reasoningBucket = raw['reasoningBucket'];
	if (reasoningBucket === 'low' || reasoningBucket === 'medium' || reasoningBucket === 'high') {
		result.reasoningBucket = reasoningBucket;
	}
	const categoryScores = raw['categoryScores'];
	if (categoryScores && typeof categoryScores === 'object' && !Array.isArray(categoryScores)) {
		const scores: Record<string, number> = {};
		for (const [category, score] of Object.entries(categoryScores as Record<string, unknown>)) {
			if (typeof score === 'number') {
				scores[category] = score;
			}
		}
		result.categoryScores = scores;
	}
	if (typeof raw['predictedLabel'] === 'string') { result.predictedLabel = raw['predictedLabel']; }
	if (typeof raw['confidence'] === 'number') { result.confidence = raw['confidence']; }
	if (Array.isArray(raw['candidateModels']) && raw['candidateModels'].every(candidate => typeof candidate === 'string')) {
		result.candidateModels = raw['candidateModels'];
	}
	return result;
}

function readContextAttribution(value: unknown): IContextAttributionData | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const raw = value as Record<string, unknown>;
	if (typeof raw['totalTokens'] !== 'number' || !Array.isArray(raw['entries'])) {
		return undefined;
	}
	const entries: IContextAttributionEntry[] = [];
	for (const item of raw['entries']) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) {
			continue;
		}
		const entry = item as Record<string, unknown>;
		if (typeof entry['kind'] !== 'string' || typeof entry['id'] !== 'string'
			|| typeof entry['label'] !== 'string' || typeof entry['tokens'] !== 'number') {
			continue;
		}
		entries.push({
			kind: entry['kind'],
			id: entry['id'],
			label: entry['label'],
			tokens: entry['tokens'],
			parentId: typeof entry['parentId'] === 'string' ? entry['parentId'] : undefined,
			attributes: entry['attributes'] && typeof entry['attributes'] === 'object' && !Array.isArray(entry['attributes'])
				? filterStringAttributes(entry['attributes'] as Record<string, unknown>)
				: undefined,
		});
	}
	const compactionsRaw = raw['compactions'];
	const compactions = compactionsRaw && typeof compactionsRaw === 'object' && !Array.isArray(compactionsRaw)
		&& typeof (compactionsRaw as Record<string, unknown>)['count'] === 'number'
		? { count: (compactionsRaw as Record<string, unknown>)['count'] as number }
		: { count: 0 };
	return { totalTokens: raw['totalTokens'] as number, entries, compactions };
}

function filterStringAttributes(raw: Record<string, unknown>): Record<string, string | undefined> {
	const result: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value === 'string' || value === undefined) {
			result[key] = value;
		}
	}
	return result;
}

export {
	ChangesetOperationTargetKind, type ChangesetOperationFollowUp, type ChangesetOperationTarget
} from './protocol/commands.js';

// chat channel). Re-exported here so consumers can import them from the glue
export {
	ChatInputAnswerState,
	ChatInputAnswerValueKind,
	ChatInputQuestionKind,
	ChatInputResponseKind,
	type ChatInputAnswer,
	type ChatInputOption,
	type ChatInputQuestion,
	type ChatInputRequest,
	type InputRequestResponsePart,
} from './protocol/state.js';


export const enum FileEditKind {
	Edit = 'edit',
	Create = 'create',
	Delete = 'delete',
	Rename = 'rename',
}


export const ROOT_STATE_URI = 'ahp-root://';

export const AHP_ROOT_SCHEME = 'ahp-root';

export const AHP_RESOURCE_WATCH_SCHEME = 'ahp-resource-watch';

export function buildResourceWatchChannelUri(descriptor: {
	readonly root: string;
	readonly recursive?: boolean;
	readonly excludes?: { items: readonly string[] };
	readonly includes?: { items: readonly string[] };
}): string {
	const payload: Record<string, unknown> = { root: descriptor.root };
	if (descriptor.recursive) { payload.recursive = true; }
	if (descriptor.excludes && descriptor.excludes.items.length > 0) {
		payload.excludes = [...descriptor.excludes.items];
	}
	if (descriptor.includes && descriptor.includes.items.length > 0) {
		payload.includes = [...descriptor.includes.items];
	}

	const json = encodeBase64(VSBuffer.fromString(JSON.stringify(payload)), false, true);
	return `${AHP_RESOURCE_WATCH_SCHEME}://r/${json}`;
}

export function parseResourceWatchChannelUri(uri: string): {
	root: string;
	recursive: boolean;
	excludes?: { items: string[] };
	includes?: { items: string[] };
} | undefined {
	let parsed: ResourceURI;
	try {
		parsed = ResourceURI.parse(uri);
	} catch {
		return undefined;
	}
	if (parsed.scheme !== AHP_RESOURCE_WATCH_SCHEME) {
		return undefined;
	}
	const encoded = parsed.path.replace(/^\//, '');
	if (!encoded) {
		return undefined;
	}
	try {
		const payload = JSON.parse(decodeBase64(encoded).toString()) as { root?: unknown; recursive?: unknown; excludes?: unknown; includes?: unknown };
		if (typeof payload.root !== 'string') {
			return undefined;
		}

		return {
			root: payload.root,
			recursive: payload.recursive === true,
			...(Array.isArray(payload.excludes) ? { excludes: { items: payload.excludes.filter((x): x is string => typeof x === 'string') } } : {}),
			...(Array.isArray(payload.includes) ? { includes: { items: payload.includes.filter((x): x is string => typeof x === 'string') } } : {}),
		};
	} catch {
		return undefined;
	}
}

export function isAhpResourceWatchChannel(uri: string): boolean {
	try {
		return ResourceURI.parse(uri).scheme === AHP_RESOURCE_WATCH_SCHEME;
	} catch {
		return false;
	}
}

export function isAhpRootChannel(uri: string): boolean {
	if (uri === ROOT_STATE_URI) {
		return true;
	}
	try {
		return ResourceURI.parse(uri).scheme === AHP_ROOT_SCHEME;
	} catch {
		return false;
	}
}

export function customizationId(uri: string, range?: TextRange): string {
	if (!range) {
		return uri;
	}
	const safeUri = uri.replace(/#/g, '%23');
	return `${safeUri}#range=${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
}


export type ICompletedToolCall = ToolCallCompletedState | ToolCallCancelledState;

export type ToolCallStatusString = ToolCallState['status'];


export function getToolOutputText(result: ToolCallResult): string | undefined {
	if (!result.content || result.content.length === 0) {
		return undefined;
	}

	const textParts: ToolResultTextContent[] = [];
	for (const c of result.content) {
		if (hasKey(c, { type: true }) && c.type === ToolResultContentType.Text) {
			textParts.push(c);
		}
	}
	if (textParts.length === 0) {
		return undefined;
	}
	return textParts.map(p => p.text).join('\n');
}

export function getInlineToolInput(toolInput: ToolInput | undefined): string | undefined {
	return typeof toolInput === 'string' ? toolInput : undefined;
}

export function getToolFileEdits(result: ToolCallResult): ToolResultFileEditContent[] {
	if (!result.content || result.content.length === 0) {
		return [];
	}
	const edits: ToolResultFileEditContent[] = [];
	for (const c of result.content) {
		if (hasKey(c, { type: true }) && c.type === ToolResultContentType.FileEdit) {
			edits.push(c);
		}
	}
	return edits;
}

export function getToolSubagentContent(result: { content?: readonly ToolResultContent[] }): ToolResultSubagentContent | undefined {
	if (!result.content || result.content.length === 0) {
		return undefined;
	}
	for (const c of result.content) {
		if (hasKey(c, { type: true }) && c.type === ToolResultContentType.Subagent) {
			return c as ToolResultSubagentContent;
		}
	}
	return undefined;
}


const SUBAGENT_URI_SEGMENT = 'subagent';
const SUBAGENT_URI_MARKER = `/${SUBAGENT_URI_SEGMENT}/`;
const SUBAGENT_URI_PATH_REGEX = /^(?<parentPath>.+)\/subagent\/(?<toolCallId>.+)$/;

function asResourceUri(uri: ProtocolURI | ResourceURI): ResourceURI {
	return typeof uri === 'string' ? ResourceURI.parse(uri) : uri;
}

function getSubagentBasePath(parentSession: ProtocolURI | ResourceURI): { parent: ResourceURI; path: string } {
	const parent = asResourceUri(parentSession);
	const parentPath = parent.path.endsWith('/') ? parent.path.slice(0, -1) : parent.path;
	return { parent, path: `${parentPath}${SUBAGENT_URI_MARKER}` };
}

export function buildSubagentSessionUri(parentSession: ProtocolURI | ResourceURI, toolCallId: string): string {
	const { parent, path } = getSubagentBasePath(parentSession);
	return parent.with({ path: `${path}${toolCallId}` }).toString();
}

export function parseSubagentSessionUri(uri: ProtocolURI | ResourceURI): { parentSession: ResourceURI; toolCallId: string } | undefined {
	const resource = asResourceUri(uri);
	const match = SUBAGENT_URI_PATH_REGEX.exec(resource.path);
	if (!match?.groups) {
		return undefined;
	}
	return {
		parentSession: resource.with({ path: match.groups.parentPath }),
		toolCallId: match.groups.toolCallId,
	};
}

export function isSubagentSession(uri: ProtocolURI | ResourceURI): boolean {
	return parseSubagentSessionUri(uri) !== undefined;
}

export function buildSubagentSessionUriPrefix(parentSession: ProtocolURI | ResourceURI): string {
	const { parent, path } = getSubagentBasePath(parentSession);
	return parent.with({ path }).toString();
}


export function createRootState(): RootState {
	return {
		agents: [],
		activeSessions: 0,
	};
}

export function createSessionState(summary: SessionSummary): SessionState {
	const state: SessionState = {
		provider: summary.provider,
		title: summary.title,
		status: summary.status,
		lifecycle: SessionLifecycle.Creating,
		activeClients: [],
		chats: [],
		defaultChat: undefined,
	};
	if (summary.activity !== undefined) { state.activity = summary.activity; }
	if (summary.project !== undefined) { state.project = summary.project; }
	if (summary.workingDirectories !== undefined) { state.workingDirectories = summary.workingDirectories; }
	if (summary.annotations !== undefined) { state.annotations = summary.annotations; }
	if (summary._meta !== undefined) { state._meta = summary._meta; }
	return state;
}

export function createChatState(summary: ChatSummary): ChatState {
	return {
		resource: summary.resource,
		title: summary.title,
		status: summary.status,
		activity: summary.activity,
		modifiedAt: summary.modifiedAt,
		origin: summary.origin,
		interactivity: summary.interactivity,
		workingDirectories: summary.workingDirectories,
		turns: [],
		activeTurn: undefined,
	};
}

export function createDefaultChatSummary(session: SessionSummary, chatUri: ProtocolURI): ChatSummary {
	const summary: ChatSummary = {
		resource: chatUri,
		title: session.title,
		status: session.status,
		modifiedAt: session.modifiedAt,
		origin: { kind: ChatOriginKind.User },
	};
	if (session.activity !== undefined) { summary.activity = session.activity; }
	return summary;
}

const STATUS_ACTIVITY_MASK = (1 << 5) - 1;

function hasAutoApprovedPendingConfirmation(state: ChatState): boolean {
	return !!state.activeTurn?.responseParts.some(part =>
		part.kind === ResponsePartKind.ToolCall
		&& part.toolCall.status === ToolCallStatus.PendingConfirmation
		&& readToolCallMeta(part.toolCall).autoApproveBySetting === true,
	);
}

function chatAwaitsUserInput(state: ChatState): boolean {
	return !!state.activeTurn?.responseParts.some(part => {
		if (part.kind === ResponsePartKind.InputRequest) {
			return part.response === undefined;
		}
		if (part.kind !== ResponsePartKind.ToolCall) {
			return false;
		}
		const status = part.toolCall.status;
		if (status === ToolCallStatus.PendingResultConfirmation || status === ToolCallStatus.AuthRequired) {
			return true;
		}
		return status === ToolCallStatus.PendingConfirmation
			&& readToolCallMeta(part.toolCall).autoApproveBySetting !== true;
	});
}

function chatSummaryStatus(state: ChatState): SessionStatus {
	const status = state.status;
	if ((status & SessionStatus.InputNeeded) !== SessionStatus.InputNeeded) {
		return status;
	}
	if (hasAutoApprovedPendingConfirmation(state) && !chatAwaitsUserInput(state)) {
		return (status & ~STATUS_ACTIVITY_MASK) | SessionStatus.InProgress;
	}
	return status;
}

export function chatSummaryFromState(state: ChatState): ChatSummary {
	const summary: ChatSummary = {
		resource: state.resource,
		title: state.title,
		status: chatSummaryStatus(state),
		modifiedAt: state.modifiedAt,
	};
	if (state.activity !== undefined) { summary.activity = state.activity; }
	if (state.origin !== undefined) { summary.origin = state.origin; }
	if (state.interactivity !== undefined) { summary.interactivity = state.interactivity; }
	if (state.workingDirectories !== undefined) { summary.workingDirectories = state.workingDirectories; }
	return summary;
}

export function effectiveChatInteractivity(interactivity: ChatInteractivity | undefined, sessionArchived: boolean): ChatInteractivity {
	if (interactivity === ChatInteractivity.Hidden) {
		return ChatInteractivity.Hidden;
	}
	if (sessionArchived) {
		return ChatInteractivity.ReadOnly;
	}
	return interactivity ?? ChatInteractivity.Full;
}

export function isChatReadOnly(interactivity: ChatInteractivity | undefined, sessionArchived: boolean): boolean {
	return effectiveChatInteractivity(interactivity, sessionArchived) === ChatInteractivity.ReadOnly;
}

export function createActiveTurn(id: string, message: Message, startedAt: string): ActiveTurn {
	return {
		id,
		startedAt,
		message,
		responseParts: [],
		usage: undefined,
	};
}

export function getTurnError(turn: Turn | undefined): ErrorInfo | undefined {
	if (turn?.state !== TurnState.Error) {
		return undefined;
	}
	const part = turn.responseParts[turn.responseParts.length - 1];
	return part?.kind === ResponsePartKind.Error ? part.error : readLegacyTurnError(turn);
}

export const enum StateComponents {
	Root,
	Session,
	Chat,
	Terminal,
	Changeset,
	Annotations,
	AutomationCatalog,
	AutomationRun,
}

export type ComponentToState = {
	[StateComponents.Root]: RootState;
	[StateComponents.Session]: SessionState;
	[StateComponents.Chat]: ChatState;
	[StateComponents.Terminal]: TerminalState;
	[StateComponents.Changeset]: ChangesetState;
	[StateComponents.Annotations]: AnnotationsState;
	[StateComponents.AutomationCatalog]: AutomationState;
	[StateComponents.AutomationRun]: AutomationRunState;
};


export const AHP_CHAT_SCHEME = 'ahp-chat';

export const DEFAULT_CHAT_ID = 'default';

export function buildChatUri(sessionUri: ProtocolURI | ResourceURI, chatId: string): string {
	const session = typeof sessionUri === 'string' ? sessionUri : sessionUri.toString();
	const encoded = encodeBase64(VSBuffer.fromString(session), false, true);
	return `${AHP_CHAT_SCHEME}://${chatId}/${encoded}`;
}

export function buildDefaultChatUri(sessionUri: ProtocolURI | ResourceURI): string {
	return buildChatUri(sessionUri, DEFAULT_CHAT_ID);
}

const SUBAGENT_CHAT_ID = 'subagent';

export function isSubagentChatUri(uri: ProtocolURI | ResourceURI): boolean {
	const parsed = typeof uri === 'string' ? ResourceURI.parse(uri) : uri;
	return parsed.scheme === AHP_CHAT_SCHEME && parsed.authority === SUBAGENT_CHAT_ID;
}

export function buildSubagentChatUri(sessionUri: ProtocolURI | ResourceURI, toolCallId: string): string {
	const session = typeof sessionUri === 'string' ? sessionUri : sessionUri.toString();
	const encoded = encodeBase64(VSBuffer.fromString(session), false, true);
	return `${AHP_CHAT_SCHEME}://${SUBAGENT_CHAT_ID}/${encoded}/${encodeURIComponent(toolCallId)}`;
}

export function parseChatUri(uri: ProtocolURI | ResourceURI): { session: string; chatId: string } | undefined {
	let parsed: ResourceURI;
	try {
		parsed = typeof uri === 'string' ? ResourceURI.parse(uri) : uri;
	} catch {
		return undefined;
	}
	if (parsed.scheme !== AHP_CHAT_SCHEME || !parsed.authority) {
		return undefined;
	}
	const encoded = parsed.path.replace(/^\//, '');
	if (!encoded) {
		return undefined;
	}
	try {
		if (parsed.authority === SUBAGENT_CHAT_ID) {
			const [sessionPart, ...toolCallIdParts] = encoded.split('/');
			const toolCallId = toolCallIdParts.join('/');
			if (!sessionPart || !toolCallId) {
				return undefined;
			}
			return { session: decodeBase64(sessionPart).toString(), chatId: `${SUBAGENT_CHAT_ID}/${decodeURIComponent(toolCallId)}` };
		}
		return { session: decodeBase64(encoded).toString(), chatId: parsed.authority };
	} catch {
		return undefined;
	}
}

export function parseDefaultChatUri(uri: ProtocolURI | ResourceURI): string | undefined {
	return parseChatUri(uri)?.session;
}

export function parseRequiredSessionUriFromChatUri(uri: ProtocolURI | ResourceURI): string {
	const session = parseDefaultChatUri(uri);
	if (session === undefined) {
		throw new Error(`Malformed AHP chat URI: ${typeof uri === 'string' ? uri : uri.toString()}`);
	}
	return session;
}

export function isDefaultChatUri(uri: ProtocolURI | ResourceURI): boolean {
	return parseChatUri(uri)?.chatId === DEFAULT_CHAT_ID;
}

export function getSessionChatResource(state: Pick<SessionState, 'defaultChat'> & { readonly chats: readonly Pick<ChatSummary, 'resource'>[] }, chatId: string): ProtocolURI | undefined {
	return chatId === DEFAULT_CHAT_ID
		? state.defaultChat ?? state.chats.find(chat => isDefaultChatUri(chat.resource))?.resource
		: state.chats.find(chat => parseChatUri(chat.resource)?.chatId === chatId)?.resource;
}

export function resolveChatUri(session: ResourceURI, chat: ResourceURI): ResourceURI {
	return isDefaultChatUri(chat) ? session : chat;
}

export function chatStorageUri(chatChannel: ProtocolURI | ResourceURI): ResourceURI | undefined {
	const parsed = parseChatUri(chatChannel);
	if (!parsed) {
		return undefined;
	}
	return resolveChatUri(ResourceURI.parse(parsed.session), ResourceURI.parse(chatChannel.toString()));
}

export function isAhpChatChannel(uri: string): boolean {
	try {
		return ResourceURI.parse(uri).scheme === AHP_CHAT_SCHEME;
	} catch {
		return false;
	}
}


export interface ISessionWithDefaultChat extends SessionState {
	turns: Turn[];
	activeTurn?: ActiveTurn;
	steeringMessage?: PendingMessage;
	queuedMessages?: PendingMessage[];
	draft?: Message;
}

export function mergeSessionWithDefaultChat(session: SessionState, chat: ChatState | undefined): ISessionWithDefaultChat {
	return {
		...session,
		workingDirectories: chat?.workingDirectories ?? session.workingDirectories,
		turns: chat?.turns ?? [],
		activeTurn: chat?.activeTurn,
		steeringMessage: chat?.steeringMessage,
		queuedMessages: chat?.queuedMessages,
		draft: chat?.draft,
	};
}

export function getActiveTurn(chat: ChatState | undefined): ActiveTurn | undefined {
	return chat?.activeTurn;
}

export function getDefaultChat(session: SessionState): ChatSummary | undefined {
	if (session.defaultChat !== undefined) {
		const match = session.chats.find(c => c.resource === session.defaultChat);
		if (match) {
			return match;
		}
	}
	return session.chats[0];
}


export type SessionMeta = Record<string, unknown>;

export type SessionSummaryMeta = Record<string, unknown>;

export const SESSION_META_GIT_KEY = 'git';

export const SESSION_META_GITHUB_KEY = 'github';

export const SESSION_META_SOURCE_CONTROL_KEY = 'vscode.sourceControl';

export const SESSION_META_PROMPT_CACHE_KEY = 'vscode.promptCache';

export const SESSION_META_MULTI_ROOT_KEY = 'multiRoot';

export const SESSION_META_EXTERNAL_KEY = 'vscode.external';

const MAX_WORKSPACE_FILE_LENGTH = 4096;

export interface ISessionMultiRootMetadata {
	readonly workspaceFile: string;
}

export function readSessionMultiRootMetadata(meta: SessionMeta | undefined): ISessionMultiRootMetadata | undefined {
	return validateSessionMultiRootMetadata(meta?.[SESSION_META_MULTI_ROOT_KEY]);
}

export function parseSessionMultiRootMetadata(value: string | undefined): ISessionMultiRootMetadata | undefined {
	if (!value) {
		return undefined;
	}
	try {
		return validateSessionMultiRootMetadata(JSON.parse(value));
	} catch {
		return undefined;
	}
}

export function withSessionMultiRootMetadata(meta: SessionMeta | undefined, multiRoot: ISessionMultiRootMetadata | undefined): SessionMeta | undefined {
	const next: SessionMeta = { ...meta };
	if (multiRoot) {
		next[SESSION_META_MULTI_ROOT_KEY] = multiRoot;
	} else {
		delete next[SESSION_META_MULTI_ROOT_KEY];
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

function validateSessionMultiRootMetadata(value: unknown): ISessionMultiRootMetadata | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const raw = value as Record<string, unknown>;
	if (typeof raw.workspaceFile !== 'string' || raw.workspaceFile.length === 0 || raw.workspaceFile.length > MAX_WORKSPACE_FILE_LENGTH) {
		return undefined;
	}
	try {
		if (!ResourceURI.parse(raw.workspaceFile, true).scheme) {
			return undefined;
		}
	} catch {
		return undefined;
	}
	return { workspaceFile: raw.workspaceFile };
}

export interface ISessionPromptCacheState {
	readonly modelId: string;
	readonly cacheExpiresAt: string;
}

export function readSessionPromptCacheState(meta: SessionMeta | undefined): ISessionPromptCacheState | undefined {
	const value = meta?.[SESSION_META_PROMPT_CACHE_KEY];
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const raw = value as Record<string, unknown>;
	return typeof raw['modelId'] === 'string' && typeof raw['cacheExpiresAt'] === 'string'
		? { modelId: raw['modelId'], cacheExpiresAt: raw['cacheExpiresAt'] }
		: undefined;
}

export function withSessionPromptCacheState(meta: SessionMeta | undefined, promptCache: ISessionPromptCacheState | undefined): SessionMeta | undefined {
	const next: SessionMeta = { ...meta };
	if (promptCache) {
		next[SESSION_META_PROMPT_CACHE_KEY] = promptCache;
	} else {
		delete next[SESSION_META_PROMPT_CACHE_KEY];
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

export const SESSION_META_FOLDER_PICKER_KEY = 'vscode.folderPicker';

export interface ISessionFolderPickerDecision {
	readonly hidden: boolean;
	readonly primary?: string;
}

export function readSessionFolderPickerDecision(meta: SessionMeta | undefined): ISessionFolderPickerDecision | undefined {
	return validateSessionFolderPickerDecision(meta?.[SESSION_META_FOLDER_PICKER_KEY]);
}

export function parseSessionFolderPickerDecision(value: string | undefined): ISessionFolderPickerDecision | undefined {
	if (!value) {
		return undefined;
	}
	try {
		return validateSessionFolderPickerDecision(JSON.parse(value));
	} catch {
		return undefined;
	}
}

function validateSessionFolderPickerDecision(value: unknown): ISessionFolderPickerDecision | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const raw = value as Record<string, unknown>;
	if (typeof raw['hidden'] !== 'boolean') {
		return undefined;
	}
	const primary = raw['primary'];
	if (primary !== undefined && (typeof primary !== 'string' || primary.length === 0 || raw['hidden'] !== true)) {
		return undefined;
	}
	return primary !== undefined ? { hidden: true, primary } : { hidden: raw['hidden'] };
}

export function withSessionFolderPickerDecision(meta: SessionMeta | undefined, decision: ISessionFolderPickerDecision | undefined): SessionMeta | undefined {
	const next: SessionMeta = { ...meta };
	if (decision) {
		next[SESSION_META_FOLDER_PICKER_KEY] = decision.primary !== undefined
			? { hidden: decision.hidden, primary: decision.primary }
			: { hidden: decision.hidden };
	} else {
		delete next[SESSION_META_FOLDER_PICKER_KEY];
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

export interface ISessionGitState {
	readonly hasGitHubRemote?: boolean;
	readonly branchName?: string;
	readonly isDetachedHead?: boolean;
	readonly baseBranchName?: string;
	readonly upstreamBranchName?: string;
	readonly incomingChanges?: number;
	readonly outgoingChanges?: number;
	readonly uncommittedChanges?: number;
	readonly hasBaseBranchChanges?: boolean;
	readonly githubOwner?: string;
	readonly githubHeadOwner?: string;
	readonly githubRepo?: string;
}

export const enum SessionSourceControlOutcome {
	Merge = 'merge',
	PullRequest = 'pullRequest',
}

export interface ISessionSourceControlState {
	readonly merge?: {
		readonly commit: string;
	};
	readonly latestOutcome?: SessionSourceControlOutcome;
}

export function readSessionSourceControlState(meta: SessionMeta | undefined): ISessionSourceControlState | undefined {
	const value = meta?.[SESSION_META_SOURCE_CONTROL_KEY];
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	const raw = value as Record<string, unknown>;
	let merge: ISessionSourceControlState['merge'];
	const rawMerge = raw['merge'];
	if (rawMerge && typeof rawMerge === 'object' && !Array.isArray(rawMerge)) {
		const commit = (rawMerge as Record<string, unknown>)['commit'];
		merge = typeof commit === 'string' && commit.length > 0 ? { commit } : undefined;
	}

	const rawLatestOutcome = raw['latestOutcome'];
	const latestOutcome = rawLatestOutcome === SessionSourceControlOutcome.Merge || rawLatestOutcome === SessionSourceControlOutcome.PullRequest
		? rawLatestOutcome
		: undefined;
	if (!merge && (!latestOutcome || latestOutcome === SessionSourceControlOutcome.Merge)) {
		return undefined;
	}
	return { merge, latestOutcome };
}

export function withSessionSourceControlState(meta: SessionMeta | undefined, state: ISessionSourceControlState | undefined): SessionMeta | undefined {
	const next: SessionMeta = { ...meta };
	if (state) {
		next[SESSION_META_SOURCE_CONTROL_KEY] = state;
	} else {
		delete next[SESSION_META_SOURCE_CONTROL_KEY];
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

export interface ISessionGitHubState {
	readonly owner?: string;
	readonly repo?: string;
	readonly pullRequestUrls?: readonly string[];
	readonly initialPullRequestUrls?: readonly string[];
	readonly associatedPullRequestUrls?: readonly string[];
	readonly pullRequestState?: 'open' | 'closed' | 'merged';
	readonly pullRequestStateUrl?: string;
	readonly pullRequestBranchName?: string;
}

export function hasSessionPullRequestForBranch(gitHubState: ISessionGitHubState | undefined, branchName: string | undefined): boolean {
	if (!gitHubState?.pullRequestUrls?.length) {
		return false;
	}
	return gitHubState.pullRequestBranchName === undefined || gitHubState.pullRequestBranchName === branchName;
}

export function getSessionRelatedPullRequestUrls(gitHubState: ISessionGitHubState | undefined): readonly string[] {
	const pullRequestUrls = gitHubState?.pullRequestUrls ?? [];
	const initialPullRequestUrls = gitHubState?.initialPullRequestUrls;
	const initialUrls = new Set(initialPullRequestUrls?.map(url => url.toLowerCase()) ?? []);
	const associatedUrls = new Set(gitHubState?.associatedPullRequestUrls?.map(url => url.toLowerCase()) ?? []);
	return pullRequestUrls.filter(url => !initialUrls.has(url.toLowerCase()) || associatedUrls.has(url.toLowerCase()));
}

export const MAX_SESSION_PULL_REQUEST_REFERENCES = 10;

export function getSessionPullRequestUrlKey(url: string): string {
	return url.trim().replace(/\/+$/, '').toLowerCase();
}

function normalizeSessionPullRequestUrls(urls: readonly string[]): string[] {
	const normalizedUrls = urls.map(url => {
		const match = /^https:\/\/(?<host>[^/]+)\/(?<owner>[^/]+)\/(?<repo>[^/]+)\/pull\/(?<number>\d+)\/?$/.exec(url);
		const groups = match?.groups;
		return groups
			? `https://${groups['host'].toLowerCase()}/${groups['owner']}/${groups['repo']}/pull/${groups['number']}`
			: url;
	});
	return distinct(normalizedUrls, getSessionPullRequestUrlKey).slice(0, MAX_SESSION_PULL_REQUEST_REFERENCES);
}

export function withMostRecentSessionPullRequest(gitHubState: ISessionGitHubState | undefined, pullRequestUrl: string, branchName: string): ISessionGitHubState {
	const pullRequestUrls = normalizeSessionPullRequestUrls([
		pullRequestUrl,
		...(gitHubState?.pullRequestUrls ?? [])
	]);
	const normalizedPullRequestUrl = pullRequestUrls[0]?.toLowerCase();
	const stateApplies = gitHubState?.pullRequestStateUrl?.toLowerCase() === normalizedPullRequestUrl;

	return {
		pullRequestUrls,
		pullRequestBranchName: branchName,
		...(stateApplies && gitHubState?.pullRequestState && gitHubState.pullRequestStateUrl
			? { pullRequestState: gitHubState.pullRequestState, pullRequestStateUrl: gitHubState.pullRequestStateUrl }
			: {}),
	};
}

export function withMostRecentRelatedSessionPullRequest(gitHubState: ISessionGitHubState | undefined, pullRequestUrl: string, branchName: string): ISessionGitHubState {
	const next = withMostRecentSessionPullRequest(gitHubState, pullRequestUrl, branchName);
	const promotedUrl = normalizeSessionPullRequestUrls([pullRequestUrl])[0]?.toLowerCase();
	const initialPullRequestUrls = gitHubState?.initialPullRequestUrls;
	const associatedPullRequestUrls = normalizeSessionPullRequestUrls([
		pullRequestUrl,
		...(gitHubState?.associatedPullRequestUrls ?? [])
	]);
	return {
		...next,
		associatedPullRequestUrls,
		...(initialPullRequestUrls !== undefined ? {
			initialPullRequestUrls: initialPullRequestUrls.filter(url => url.toLowerCase() !== promotedUrl)
		} : {}),
	};
}

export function withInitialSessionPullRequest(gitHubState: ISessionGitHubState | undefined, pullRequestUrl?: string): ISessionGitHubState {
	return {
		initialPullRequestUrls: normalizeSessionPullRequestUrls([
			...(pullRequestUrl ? [pullRequestUrl] : []),
			...(gitHubState?.initialPullRequestUrls ?? [])
		])
	};
}

export function readSessionGitState(meta: SessionMeta | undefined): ISessionGitState | undefined {
	const value = meta?.[SESSION_META_GIT_KEY];
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const raw = value as Record<string, unknown>;
	const result: {
		hasGitHubRemote?: boolean;
		branchName?: string;
		isDetachedHead?: boolean;
		baseBranchName?: string;
		upstreamBranchName?: string;
		incomingChanges?: number;
		outgoingChanges?: number;
		uncommittedChanges?: number;
		hasBaseBranchChanges?: boolean;
		githubOwner?: string;
		githubHeadOwner?: string;
		githubRepo?: string;
	} = {};
	if (typeof raw['hasGitHubRemote'] === 'boolean') { result.hasGitHubRemote = raw['hasGitHubRemote']; }
	if (typeof raw['branchName'] === 'string') { result.branchName = raw['branchName']; }
	if (typeof raw['isDetachedHead'] === 'boolean') { result.isDetachedHead = raw['isDetachedHead']; }
	if (typeof raw['baseBranchName'] === 'string') { result.baseBranchName = raw['baseBranchName']; }
	if (typeof raw['upstreamBranchName'] === 'string') { result.upstreamBranchName = raw['upstreamBranchName']; }
	if (typeof raw['incomingChanges'] === 'number') { result.incomingChanges = raw['incomingChanges']; }
	if (typeof raw['outgoingChanges'] === 'number') { result.outgoingChanges = raw['outgoingChanges']; }
	if (typeof raw['uncommittedChanges'] === 'number') { result.uncommittedChanges = raw['uncommittedChanges']; }
	if (typeof raw['hasBaseBranchChanges'] === 'boolean') { result.hasBaseBranchChanges = raw['hasBaseBranchChanges']; }
	if (typeof raw['githubOwner'] === 'string') { result.githubOwner = raw['githubOwner']; }
	if (typeof raw['githubHeadOwner'] === 'string') { result.githubHeadOwner = raw['githubHeadOwner']; }
	if (typeof raw['githubRepo'] === 'string') { result.githubRepo = raw['githubRepo']; }
	return result;
}

export function needsSessionGitStateRefresh(gitState: ISessionGitState | undefined): boolean {
	return gitState === undefined || (gitState.branchName === undefined && !gitState.isDetachedHead);
}

export function withSessionGitState(meta: SessionMeta | undefined, gitState: ISessionGitState | undefined): SessionMeta | undefined {
	const next: { [key: string]: unknown } = { ...meta };
	if (gitState !== undefined) {
		next[SESSION_META_GIT_KEY] = gitState;
	} else {
		delete next[SESSION_META_GIT_KEY];
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

export function readSessionGitHubState(meta: SessionSummaryMeta | undefined): ISessionGitHubState | undefined {
	const value = meta?.[SESSION_META_GITHUB_KEY];
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const raw = value as Record<string, unknown>;
	const result: {
		owner?: string;
		repo?: string;
		pullRequestUrls?: readonly string[];
		initialPullRequestUrls?: readonly string[];
		associatedPullRequestUrls?: readonly string[];
		pullRequestState?: 'open' | 'closed' | 'merged';
		pullRequestStateUrl?: string;
		pullRequestBranchName?: string;
	} = {};

	if (typeof raw['owner'] === 'string') { result.owner = raw['owner']; }
	if (typeof raw['repo'] === 'string') { result.repo = raw['repo']; }
	const pullRequestUrls = Array.isArray(raw['pullRequestUrls'])
		? raw['pullRequestUrls'].filter((url): url is string => typeof url === 'string')
		: typeof raw['pullRequestUrl'] === 'string'
			? [raw['pullRequestUrl']]
			: [];
	if (pullRequestUrls.length > 0) {
		result.pullRequestUrls = normalizeSessionPullRequestUrls(pullRequestUrls);
	}
	if (Array.isArray(raw['initialPullRequestUrls'])) {
		result.initialPullRequestUrls = normalizeSessionPullRequestUrls(raw['initialPullRequestUrls'].filter((url): url is string => typeof url === 'string'));
	}
	if (Array.isArray(raw['associatedPullRequestUrls'])) {
		const associatedPullRequestUrls = normalizeSessionPullRequestUrls(raw['associatedPullRequestUrls'].filter((url): url is string => typeof url === 'string'));
		if (associatedPullRequestUrls.length > 0) {
			result.associatedPullRequestUrls = associatedPullRequestUrls;
		}
	}
	if (raw['pullRequestState'] === 'open' || raw['pullRequestState'] === 'closed' || raw['pullRequestState'] === 'merged') {
		result.pullRequestState = raw['pullRequestState'];
	}
	if (typeof raw['pullRequestStateUrl'] === 'string') { result.pullRequestStateUrl = raw['pullRequestStateUrl']; }
	if (typeof raw['pullRequestBranchName'] === 'string') { result.pullRequestBranchName = raw['pullRequestBranchName']; }
	return result;
}

export function withSessionGitHubState(meta: SessionSummaryMeta | undefined, gitHubState: ISessionGitHubState | undefined): SessionSummaryMeta | undefined {
	const next: { [key: string]: unknown } = { ...meta };
	if (gitHubState !== undefined) {
		next[SESSION_META_GITHUB_KEY] = gitHubState;
	} else {
		delete next[SESSION_META_GITHUB_KEY];
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

export const SESSION_META_SPAWN_DEPTH_KEY = 'agentHost/sessionSpawnDepth';

export function readSessionSpawnDepth(meta: SessionSummaryMeta | undefined): number {
	const value = meta?.[SESSION_META_SPAWN_DEPTH_KEY];
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function withSessionSpawnDepth(meta: SessionSummaryMeta | undefined, depth: number): SessionSummaryMeta {
	return { ...meta, [SESSION_META_SPAWN_DEPTH_KEY]: depth };
}

export const SESSION_META_CREATED_BY_SESSION_KEY = 'agentHost/createdBySession';
export const AH_META_CREATED_BY_SESSION_DB_KEY = 'agentHost.createdBySession';

export interface ISessionCreationReference {
	readonly session: string;
	readonly chat?: string;
	readonly turnId?: string;
}

export function readSessionCreationReference(meta: SessionSummaryMeta | undefined): ISessionCreationReference | undefined {
	return parseSessionCreationReferenceValue(meta?.[SESSION_META_CREATED_BY_SESSION_KEY]);
}

function parseSessionCreationReferenceValue(value: unknown): ISessionCreationReference | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const candidate = value as { [key: string]: unknown };
	if (typeof candidate.session !== 'string') {
		return undefined;
	}
	return {
		session: candidate.session,
		...(typeof candidate.chat === 'string' ? { chat: candidate.chat } : {}),
		...(typeof candidate.turnId === 'string' ? { turnId: candidate.turnId } : {}),
	};
}

export function parseSessionCreationReference(value: string | undefined): ISessionCreationReference | undefined {
	if (!value) {
		return undefined;
	}
	try {
		return readSessionCreationReference({ [SESSION_META_CREATED_BY_SESSION_KEY]: JSON.parse(value) });
	} catch {
		return undefined;
	}
}

export function withSessionCreationReference(meta: SessionSummaryMeta | undefined, creationReference: ISessionCreationReference): SessionSummaryMeta {
	return { ...meta, [SESSION_META_CREATED_BY_SESSION_KEY]: creationReference };
}

export const SESSION_META_WORKSPACELESS_KEY = 'workspaceless';

export const AH_META_WORKSPACELESS_DB_KEY = 'agentHost.workspaceless';

export const AH_META_HAS_WORKSPACE_TRANSITIONS_DB_KEY = 'agentHost.hasWorkspaceTransitions';

export const SESSION_META_HAS_WORKSPACE_TRANSITIONS_KEY = 'hasWorkspaceTransitions';

export const AH_META_WORKSPACE_CONVERSION_QUARANTINED_DB_KEY = 'agentHost.workspaceConversionQuarantined';

export const AH_META_IS_ARCHIVED_DB_KEY = 'isArchived';

export const AH_META_IS_DONE_DB_KEY = 'isDone';

export const AH_META_IS_READ_DB_KEY = 'isRead';

export function withSessionStatusFlag(status: SessionStatus, flag: SessionStatus, set: boolean): SessionStatus {
	return set ? (status | flag) : (status & ~flag);
}

export function isSessionStatusRead(status: SessionStatus | undefined): boolean {
	return status !== undefined && (status & SessionStatus.IsRead) !== 0;
}

export function isSessionStatusArchived(status: SessionStatus | undefined): boolean {
	return status !== undefined && (status & SessionStatus.IsArchived) !== 0;
}

export function readSessionWorkspaceless(meta: SessionSummaryMeta | undefined): boolean {
	return meta?.[SESSION_META_WORKSPACELESS_KEY] === true;
}

export function withSessionWorkspaceless(meta: SessionSummaryMeta | undefined, workspaceless: boolean): SessionSummaryMeta | undefined {
	const next: { [key: string]: unknown } = { ...meta };
	if (workspaceless) {
		next[SESSION_META_WORKSPACELESS_KEY] = true;
	} else {
		delete next[SESSION_META_WORKSPACELESS_KEY];
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

export function readSessionHasWorkspaceTransitions(meta: SessionSummaryMeta | undefined): boolean {
	return meta?.[SESSION_META_HAS_WORKSPACE_TRANSITIONS_KEY] === true;
}

export function withSessionHasWorkspaceTransitions(meta: SessionSummaryMeta | undefined, hasTransitions: boolean): SessionSummaryMeta | undefined {
	const next: { [key: string]: unknown } = { ...meta };
	if (hasTransitions) {
		next[SESSION_META_HAS_WORKSPACE_TRANSITIONS_KEY] = true;
	} else {
		delete next[SESSION_META_HAS_WORKSPACE_TRANSITIONS_KEY];
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

export function readSessionExternal(meta: SessionSummaryMeta | undefined): boolean {
	return meta?.[SESSION_META_EXTERNAL_KEY] === true;
}

export function withSessionExternal(meta: SessionSummaryMeta | undefined, external: boolean): SessionSummaryMeta | undefined {
	const next: { [key: string]: unknown } = { ...meta };
	if (external) {
		next[SESSION_META_EXTERNAL_KEY] = true;
	} else {
		delete next[SESSION_META_EXTERNAL_KEY];
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

export const SESSION_META_EHCLI_ADOPTABLE_KEY = 'ehcliAdoptable';

export function readSessionEhcliAdoptable(meta: SessionSummaryMeta | undefined): boolean {
	return meta?.[SESSION_META_EHCLI_ADOPTABLE_KEY] === true;
}

export function withSessionEhcliAdoptable(meta: SessionSummaryMeta | undefined): SessionSummaryMeta {
	return { ...meta, [SESSION_META_EHCLI_ADOPTABLE_KEY]: true };
}

export const AH_META_EHCLI_ADOPTED_DB_KEY = 'agentHost.ehcliAdopted';

export const SESSION_META_EHCLI_ADOPTED_KEY = 'ehcliAdopted';

export function readSessionEhcliAdopted(meta: SessionSummaryMeta | undefined): boolean {
	return meta?.[SESSION_META_EHCLI_ADOPTED_KEY] === true;
}

export function withSessionEhcliAdopted(meta: SessionSummaryMeta | undefined, adopted: boolean): SessionSummaryMeta | undefined {
	const next: { [key: string]: unknown } = { ...meta };
	if (adopted) {
		next[SESSION_META_EHCLI_ADOPTED_KEY] = true;
	} else {
		delete next[SESSION_META_EHCLI_ADOPTED_KEY];
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

export const AH_META_EHCLI_LAST_TURN_DB_KEY = 'agentHost.ehcliLastMigratedTurn';

export const SESSION_META_EHCLI_LAST_TURN_KEY = 'ehcliLastMigratedTurn';

export function readSessionEhcliLastMigratedTurn(meta: SessionSummaryMeta | undefined): string | undefined {
	const value = meta?.[SESSION_META_EHCLI_LAST_TURN_KEY];
	return typeof value === 'string' && value ? value : undefined;
}

export function withSessionEhcliLastMigratedTurn(meta: SessionSummaryMeta | undefined, turnId: string | undefined): SessionSummaryMeta | undefined {
	if (!turnId) {
		return meta;
	}
	return { ...meta, [SESSION_META_EHCLI_LAST_TURN_KEY]: turnId };
}

export function readSessionMatchesByProjectRoot(meta: SessionSummaryMeta | undefined): boolean {
	return readSessionEhcliAdoptable(meta) || readSessionEhcliAdopted(meta);
}


export type RootMeta = Record<string, unknown>;

export const ROOT_META_HOST_BUILD_KEY = 'hostBuild';

export interface IHostBuildInfo {
	readonly version: string;
	readonly commit?: string;
	readonly date?: string;
	readonly quality?: string;
}

export function hostBuildInfoFromProduct(productService: IProductService): IHostBuildInfo {
	return {
		version: productService.version,
		commit: productService.commit,
		date: productService.date,
		quality: productService.quality,
	};
}

export function readHostBuildInfo(state: RootState | undefined): IHostBuildInfo | undefined {
	const meta = state?._meta;
	const value = meta?.[ROOT_META_HOST_BUILD_KEY];
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const raw = value as Record<string, unknown>;
	if (typeof raw['version'] !== 'string') {
		return undefined;
	}
	const result: { version: string; commit?: string; date?: string; quality?: string } = {
		version: raw['version'],
	};
	if (typeof raw['commit'] === 'string') { result.commit = raw['commit']; }
	if (typeof raw['date'] === 'string') { result.date = raw['date']; }
	if (typeof raw['quality'] === 'string') { result.quality = raw['quality']; }
	return result;
}

export function withHostBuildInfo(meta: RootMeta | undefined, buildInfo: IHostBuildInfo | undefined): RootMeta | undefined {
	const next: { [key: string]: unknown } = { ...meta };
	if (buildInfo !== undefined) {
		next[ROOT_META_HOST_BUILD_KEY] = buildInfo;
	} else {
		delete next[ROOT_META_HOST_BUILD_KEY];
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

export function formatHostBuildInfo(info: IHostBuildInfo): string {
	const details: string[] = [];
	if (info.commit) { details.push(`commit ${info.commit}`); }
	if (info.date) { details.push(info.date); }
	if (info.quality) { details.push(info.quality); }
	return details.length > 0 ? `${info.version} (${details.join(', ')})` : info.version;
}

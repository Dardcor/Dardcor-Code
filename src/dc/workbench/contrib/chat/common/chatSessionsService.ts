/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { IMarkdownString } from '../../../../base/common/htmlContent.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IObservable } from '../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { IPosition } from '../../../../editor/common/core/position.js';
import { isRemoteAgentHostSessionType } from '../../../../platform/agentHost/common/agentHostSessionType.js';
import { createDecorator, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { LOCAL_AGENT_HOST_SCHEME_PREFIX } from '../../../../platform/agentHost/common/agentHostConnectionsService.js';
import { IChatAgentAttachmentCapabilities, IChatAgentRequest } from './participants/chatAgents.js';
import { IChatEditingSession } from './editing/chatEditingService.js';
import { IChatRequestModeInstructions, IChatRequestVariableData, ISerializableChatModelInputState } from './model/chatModel.js';
import { IChatRequestOrigin } from './chatRequestOrigin.js';
import { IChatProgress, IChatResponseErrorDetails, IChatSessionTiming } from './chatService/chatService.js';
import { ChatAgentLocation } from './constants.js';
import { Target } from './promptSyntax/promptTypes.js';

export const enum ChatSessionsExtensions {
	AsyncActivation = 'workbench.contrib.chatSessions.asyncActivation'
}

export interface IAsyncChatSessionActivationContribution {
	matchSessionType(sessionType: string): boolean;
	waitForActivation(accessor: ServicesAccessor, sessionType: string): Promise<boolean>;
}

export interface IAsyncChatSessionActivationRegistry {
	register(contribution: IAsyncChatSessionActivationContribution): IDisposable;
	getActivators(sessionType: string): readonly IAsyncChatSessionActivationContribution[];
}

class AsyncChatSessionActivationRegistry implements IAsyncChatSessionActivationRegistry {
	private readonly _contributions = new Set<IAsyncChatSessionActivationContribution>();

	register(contribution: IAsyncChatSessionActivationContribution): IDisposable {
		this._contributions.add(contribution);
		return {
			dispose: () => this._contributions.delete(contribution)
		};
	}

	getActivators(sessionType: string): readonly IAsyncChatSessionActivationContribution[] {
		return Array.from(this._contributions).filter(contribution => contribution.matchSessionType(sessionType));
	}
}

Registry.add(ChatSessionsExtensions.AsyncActivation, new AsyncChatSessionActivationRegistry());

export const enum ChatSessionStatus {
	Failed = 0,
	Completed = 1,
	InProgress = 2,
	NeedsInput = 3
}

export interface IChatSessionCommandContribution {
	readonly name: string;
	readonly description: string;
	readonly when?: string;
}

export interface IChatSessionProviderOptionModelMetadata {
	readonly name: string;
	readonly id: string;
	readonly vendor?: string;
	readonly version?: string;
	readonly family?: string;
	readonly tooltip?: string;
	readonly pricing?: string;
	readonly multiplierNumeric?: number;
	readonly inputCost?: number;
	readonly outputCost?: number;
	readonly cacheCost?: number;
	readonly cacheWriteCost?: number;
	readonly longContextInputCost?: number;
	readonly longContextOutputCost?: number;
	readonly longContextCacheCost?: number;
	readonly longContextCacheWriteCost?: number;
	readonly priceCategory?: string;
	readonly promo?: {
		readonly id: string;
		readonly discountPercent: number;
		readonly endsAt?: string;
		readonly message: string;
	};
	readonly maxInputTokens?: number;
	readonly maxOutputTokens?: number;
	readonly capabilities?: {
		readonly vision?: boolean;
		readonly toolCalling?: boolean;
	};
}

export interface IChatSessionProviderOptionItem {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly detail?: string;
	readonly locked?: boolean;
	readonly icon?: ThemeIcon;
	readonly default?: boolean;
	readonly slashCommand?: string;
	readonly tooltip?: string;
	readonly modelMetadata?: IChatSessionProviderOptionModelMetadata;
}

export interface IChatSessionProviderOptionGroupCommand {
	readonly command: string;
	readonly title: string;
	readonly tooltip?: string;
	readonly arguments?: readonly unknown[];
}

export interface IChatSessionProviderOptionGroup {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly detail?: string;
	readonly selected?: IChatSessionProviderOptionItem;
	readonly items: readonly IChatSessionProviderOptionItem[];
	readonly when?: string;
	readonly icon?: ThemeIcon;
	readonly commands?: readonly IChatSessionProviderOptionGroupCommand[];
	readonly kind?: 'permissions';
}

export interface IChatSessionsExtensionPoint {
	readonly type: string;
	readonly name: string;
	readonly displayName: string;
	readonly description: string;
	readonly when?: string;
	readonly icon?: string | { light: string; dark: string };
	readonly order?: number;
	readonly alternativeIds?: string[];
	readonly welcomeTitle?: string;
	readonly welcomeMessage?: string;
	readonly welcomeTips?: string;
	readonly inputPlaceholder?: string;
	readonly capabilities?: IChatAgentAttachmentCapabilities;
	readonly commands?: IChatSessionCommandContribution[];
	readonly locations?: ChatAgentLocation[];
	readonly canDelegate?: boolean;
	readonly isReadOnly?: boolean;
	readonly customAgentTarget?: Target;
	readonly requiresCustomModels?: boolean;
	readonly supportsAutoModel?: boolean;
	readonly agentHostProviderId?: string;
	readonly requiresCopilotSignIn?: boolean | (() => boolean);
	readonly onDidChangeRequiresCopilotSignIn?: Event<void>;
	readonly supportsDelegation?: boolean;
	readonly autoAttachReferences?: boolean;
}

export interface IChatSessionItem {
	readonly resource: URI;
	readonly label: string;
	readonly iconPath?: ThemeIcon;
	readonly badge?: string | IMarkdownString;
	readonly description?: string | IMarkdownString;
	readonly status?: ChatSessionStatus;
	readonly tooltip?: string | IMarkdownString;
	readonly timing: IChatSessionTiming;
	readonly changes?: {
		readonly files: number;
		readonly insertions: number;
		readonly deletions: number;
	} | readonly IChatSessionFileChange[] | readonly IChatSessionFileChange2[];
	readonly archived?: boolean;
	readonly isRead?: boolean;
	readonly metadata?: IChatSessionItemMetadata;
	readonly legacyResource?: URI;
}

export interface IChatSessionItemMetadata {
	readonly repositoryPath?: string;
	readonly workingDirectoryPath?: string;
	readonly firstCheckpointRef?: string;
	readonly lastCheckpointRef?: string;
	readonly worktreePath?: string;
	readonly uncommittedChanges?: number;
	readonly baseRefOid?: string;
	readonly headRefOid?: string;
	readonly branchName?: string;
	readonly branch?: string;
	readonly baseBranchName?: string;
	readonly baseBranch?: string;
	readonly baseBranchProtected?: boolean;
	readonly hasGitHubRemote?: boolean;
	readonly upstreamBranchName?: string;
	readonly incomingChanges?: number;
	readonly outgoingChanges?: number;

	readonly [key: string]: unknown;
}

export interface IChatSessionFileChange {
	readonly modifiedUri: URI;
	readonly originalUri?: URI;
	readonly insertions: number;
	readonly deletions: number;
	readonly reviewed?: boolean;
}

export interface IChatSessionFileChange2 {
	readonly uri: URI;
	readonly originalUri?: URI;
	readonly modifiedUri?: URI;
	readonly insertions: number;
	readonly deletions: number;
	readonly reviewed?: boolean;
}

export type IChatSessionHistoryItem = {
	id?: string;
	type: 'request';
	prompt: string;
	participant: string;
	command?: string;
	variableData?: IChatRequestVariableData;
	modelId?: string;
	timestamp?: number;
	modeInstructions?: IChatRequestModeInstructions;
	isSystemInitiated?: boolean;
	isHidden?: boolean;
	isRequestHidden?: boolean;
	systemInitiatedLabel?: string;
	isTerminalRequest?: boolean;
	origin?: IChatRequestOrigin;
} | {
	type: 'response';
	parts: IChatProgress[];
	participant: string;
	details?: string;
	elapsedMs?: number;
	completedAt?: number;
	errorDetails?: IChatResponseErrorDetails;
};

export type IChatSessionRequestHistoryItem = Extract<IChatSessionHistoryItem, { type: 'request' }>;

export interface IChatSessionServerRequest {
	readonly id: string;
	readonly prompt: string;
	readonly variableData?: IChatRequestVariableData;
	readonly timestamp?: number;
	readonly isSystemInitiated?: boolean;
	readonly isHidden?: boolean;
	readonly isRequestHidden?: boolean;
	readonly systemInitiatedLabel?: string;
	readonly isTerminalRequest?: boolean;
	readonly resume?: boolean;
	readonly origin?: IChatRequestOrigin;
}

export function isTerminalCommandPrompt(text: string, prefix: string | undefined): boolean {
	return !!prefix && text.startsWith(prefix) && text.slice(prefix.length).trim().length > 0;
}

export namespace SessionType {
	export const CopilotCLI = 'copilotcli';
	export const Local = 'local';
	export const Codex = 'openai-codex';
	export const AgentHostCopilot = 'agent-host-copilotcli';
	export const AgentHostClaude = 'agent-host-claude';
	export const AgentHostCodex = 'agent-host-codex';
}

export function isLocalAgentHostTarget(target: string): boolean {
	return target === SessionType.AgentHostCopilot ||
		target.startsWith(LOCAL_AGENT_HOST_SCHEME_PREFIX);
}

export function isRemoteAgentHostTarget(target: string): boolean {
	return isRemoteAgentHostSessionType(target);
}

export function isAgentHostTarget(target: string): boolean {
	return isLocalAgentHostTarget(target) || isRemoteAgentHostTarget(target);
}

export function isAgentHostSessionResource(resource: URI): boolean {
	return isAgentHostTarget(resource.scheme);
}

export const localChatSessionType = SessionType.Local;

export interface IChatSession extends IDisposable {
	readonly onWillDispose: Event<void>;

	readonly sessionResource: URI;

	readonly title?: string;

	readonly history: readonly IChatSessionHistoryItem[];


	readonly options?: ReadonlyChatSessionOptionsMap;

	readonly progressObs?: IObservable<IChatProgress[]>;
	readonly isCompleteObs?: IObservable<boolean>;
	readonly isReadOnly?: IObservable<boolean>;
	readonly interruptActiveResponseCallback?: () => Promise<boolean>;

	readonly onDidStartServerRequest?: Event<IChatSessionServerRequest>;

	transferredState?: {
		readonly editingSession: IChatEditingSession | undefined;
		readonly inputState: ISerializableChatModelInputState | undefined;
	};

	requestHandler?: (
		request: IChatAgentRequest,
		progress: (progress: IChatProgress[]) => void,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		history: any[],
		token: CancellationToken
	) => Promise<void>;

	forkSession?: (request: IChatSessionRequestHistoryItem | undefined, token: CancellationToken) => Promise<IChatSessionItem>;

	renameSession?: (title: string, token: CancellationToken) => Promise<void>;
}

export interface IChatSessionContentProvider {
	provideChatSessionContent(sessionResource: URI, token: CancellationToken): Promise<IChatSession>;

	updateChatSessionMetadata?(sessionResource: URI, metadata: Record<string, unknown>): void;

	resolveChatResponseUri?(sessionResource: URI, href: string, kind: 'link' | 'image'): string;

	provideChatInputCompletions?(sessionResource: URI, params: IChatInputCompletionsParams, token: CancellationToken): Promise<IChatInputCompletionsResult | undefined>;

	provideChatInputCompletionTriggerCharacters?(): Promise<readonly string[]>;
}

export interface IChatInputCompletionsParams {
	readonly text: string;
	readonly offset: number;
}

export interface IChatInputCompletionItem {
	readonly insertText: string;
	readonly label?: string;
	readonly start?: IPosition;
	readonly end?: IPosition;
	readonly attachment: IChatInputCompletionResourceAttachment | IChatInputCompletionCommandAttachment | IChatInputCompletionSkillAttachment | IChatInputCompletionChatAttachment;
}

export interface IChatInputCompletionResourceAttachment {
	readonly kind: 'resource';
	readonly uri: URI;
	readonly displayName?: string;
	readonly isDirectory?: boolean;
	readonly _meta?: Record<string, unknown>;
}

export interface IChatInputCompletionCommandAttachment {
	readonly kind: 'command';
	readonly command: string;
	readonly isSkill?: true;
	readonly description: string;
	readonly _meta?: Record<string, unknown>;
}

export interface IChatInputCompletionSkillAttachment {
	readonly kind: 'skill';
	readonly uri: URI;
	readonly displayName?: string;
	readonly description?: string;
	readonly _meta?: Record<string, unknown>;
}

export interface IChatInputCompletionChatAttachment {
	readonly kind: 'chat';
	readonly uri: URI;
	readonly endTurn?: string;
	readonly title: string;
	readonly displayName?: string;
	readonly _meta?: Record<string, unknown>;
}

export interface IChatInputCompletionsResult {
	readonly items: readonly IChatInputCompletionItem[];
}

export interface IChatNewSessionRequest {
	readonly prompt: string;
	readonly command?: string;

	readonly initialSessionOptions?: ReadonlyChatSessionOptionsMap;
	readonly _meta?: Record<string, unknown>;
	readonly isEphemeral?: boolean;

	readonly untitledResource?: URI;
}

export interface IChatSessionItemsDelta {
	readonly addedOrUpdated?: readonly IChatSessionItem[];
	readonly removed?: readonly URI[];
}

export interface IChatSessionItemController {

	readonly onDidChangeChatSessionItems: Event<IChatSessionItemsDelta>;

	get items(): readonly IChatSessionItem[];

	refresh(token: CancellationToken): Promise<void>;

	newChatSessionItem?(request: IChatNewSessionRequest, token: CancellationToken): Promise<IChatSessionItem | undefined>;

	notifySessionMaterialized?(resource: URI): void;

	getNewChatSessionInputState?(sessionResource: URI, token: CancellationToken): Promise<readonly IChatSessionProviderOptionGroup[] | undefined>;

	resolveChatSessionItem?(resource: URI, token: CancellationToken): Promise<IChatSessionItem | undefined>;

	deleteChatSessionItem?(resource: URI, token: CancellationToken): Promise<void>;

	setChatSessionItemArchived?(resource: URI, archived: boolean): void;

	setChatSessionItemRead?(resource: URI, isRead: boolean): void;
}

export interface IChatSessionOptionsChangeEvent {
	readonly sessionResource: URI;
	readonly updates: ReadonlyMap<string, string | IChatSessionProviderOptionItem | undefined>;
}

export type ResolvedChatSessionsExtensionPoint = Omit<IChatSessionsExtensionPoint, 'icon'> & {
	readonly icon: ThemeIcon | URI | undefined;
};

export type ChatSessionOptionsMap = Map<string, string | IChatSessionProviderOptionItem>;

export namespace ChatSessionOptionsMap {
	export function fromRecord(obj: { [key: string]: string | IChatSessionProviderOptionItem }): ChatSessionOptionsMap {
		return new Map(Object.entries(obj));
	}

	export function toRecord(map: ReadonlyChatSessionOptionsMap): Record<string, string | IChatSessionProviderOptionItem> {
		const record: Record<string, string | IChatSessionProviderOptionItem> = Object.create(null);
		const entries = ensureIterable(map);
		for (const [key, value] of entries) {
			record[key] = value;
		}
		return record;
	}

	export function toStrValueArray(map: ReadonlyChatSessionOptionsMap | undefined): Array<{ optionId: string; value: string }> | undefined {
		if (!map) {
			return undefined;
		}
		const entries = ensureIterable(map);
		return Array.from(entries, ([optionId, value]) => ({ optionId, value: typeof value === 'string' ? value : value.id }));
	}

	function ensureIterable(map: ReadonlyChatSessionOptionsMap): Iterable<[string, string | IChatSessionProviderOptionItem]> {
		if (map instanceof Map) {
			return map;
		}
		return Object.entries(map as unknown as Record<string, string | IChatSessionProviderOptionItem>);
	}
}

export type ReadonlyChatSessionOptionsMap = ReadonlyMap<string, string | IChatSessionProviderOptionItem>;

export interface IChatSessionCustomizationItem {
	readonly label: string;
	readonly description?: string;
	readonly uri: URI;
	readonly storageLocation: number;
	readonly icon?: ThemeIcon;
}

export interface IChatSessionCustomizationItemGroup {
	readonly id: string;
	readonly items: IChatSessionCustomizationItem[];
	readonly commands?: readonly { readonly id: string; readonly title: string; readonly arguments?: readonly unknown[] }[];
	readonly itemCommands?: readonly { readonly id: string; readonly title: string; readonly arguments?: readonly unknown[] }[];
}

export interface IChatSessionCustomizationsProvider {
	readonly onDidChangeCustomizations: Event<void>;
	provideCustomizations(token: CancellationToken): Promise<IChatSessionCustomizationItemGroup[] | undefined>;
}


export interface IChatSessionCommitEvent {
	readonly original: URI;
	readonly committed: URI;
}

export const IChatSessionsService = createDecorator<IChatSessionsService>('chatSessionsService');

export interface IChatSessionsService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeItemsProviders: Event<{ readonly chatSessionType: string }>;
	readonly onDidChangeSessionItems: Event<IChatSessionItemsDelta>;

	readonly onDidCommitSession: Event<IChatSessionCommitEvent>;

	readonly onDidChangeAvailability: Event<void>;
	readonly onDidChangeInProgress: Event<void>;

	getChatSessionContribution(chatSessionType: string): ResolvedChatSessionsExtensionPoint | undefined;
	getAllChatSessionContributions(): ResolvedChatSessionsExtensionPoint[];




	getChatSessionHistory(sessionResource: URI, token: CancellationToken): Promise<readonly IChatSessionHistoryItem[]>;

	registerChatSessionContribution(contribution: IChatSessionsExtensionPoint): IDisposable;

	registerChatSessionItemController(chatSessionType: string, controller: IChatSessionItemController): IDisposable;
	getRegisteredChatSessionItemProviders(): readonly string[];
	activateChatSessionItemProvider(chatSessionType: string): Promise<void>;

	getChatSessionItems(providerTypeFilter: readonly string[] | undefined, token: CancellationToken): AsyncIterable<{ readonly chatSessionType: string; readonly items: readonly IChatSessionItem[] }>;

	refreshChatSessionItems(providerTypeFilter: readonly string[] | undefined, token: CancellationToken): Promise<void>;

	getInProgress(): { chatSessionType: string; count: number }[];

	resolveChatSessionItem(chatSessionType: string, resource: URI, token: CancellationToken): Promise<IChatSessionItem | undefined>;

	canSetChatSessionItemArchived(sessionResource: URI): boolean;

	setChatSessionItemArchived(sessionResource: URI, archived: boolean): void;

	canSetChatSessionItemRead(sessionResource: URI): boolean;

	setChatSessionItemRead(sessionResource: URI, isRead: boolean): void;


	readonly onDidChangeContentProviderSchemes: Event<{ readonly added: string[]; readonly removed: string[] }>;

	getContentProviderSchemes(): string[];

	registerChatSessionContentProvider(scheme: string, provider: IChatSessionContentProvider): IDisposable;
	canResolveChatSession(sessionType: string): Promise<boolean>;
	getOrCreateChatSession(sessionResource: URI, token: CancellationToken): Promise<IChatSession>;
	updateChatSessionMetadata(sessionResource: URI, metadata: Record<string, unknown>): boolean;
	resolveChatResponseUri(sessionResource: URI, href: string, kind: 'link' | 'image'): string;

	provideChatInputCompletions(sessionResource: URI, params: IChatInputCompletionsParams, token: CancellationToken): Promise<IChatInputCompletionsResult | undefined>;

	getChatInputCompletionTriggerCharacters(sessionType: string): Promise<readonly string[] | undefined>;

	getSessionOptions(sessionResource: URI): ReadonlyChatSessionOptionsMap | undefined;
	getSessionOption(sessionResource: URI, optionId: string): string | IChatSessionProviderOptionItem | undefined;
	setSessionOption(sessionResource: URI, optionId: string, value: string | IChatSessionProviderOptionItem): boolean;
	updateSessionOptions(sessionResource: URI, updates: ReadonlyChatSessionOptionsMap): boolean;

	readonly onDidChangeSessionOptions: Event<IChatSessionOptionsChangeEvent>;

	getCapabilitiesForSessionType(chatSessionType: string): IChatAgentAttachmentCapabilities | undefined;

	getCustomAgentTargetForSessionType(chatSessionType: string): Target;

	requiresCustomModelsForSessionType(chatSessionType: string): boolean;

	supportsAutoModelForSessionType(chatSessionType: string): boolean;

	requiresCopilotSignInForSessionType(chatSessionType: string): boolean;

	supportsDelegationForSessionType(chatSessionType: string): boolean;

	sessionSupportsFork(sessionResource: URI): boolean;

	forkChatSession(sessionResource: URI, request: IChatSessionRequestHistoryItem | undefined, token: CancellationToken): Promise<IChatSessionItem>;

	sessionSupportsRename(sessionResource: URI): boolean;

	renameChatSession(sessionResource: URI, title: string, token: CancellationToken): Promise<void>;

	readonly onDidChangeOptionGroups: Event<string>;

	getOptionGroupsForSessionType(chatSessionType: string): IChatSessionProviderOptionGroup[] | undefined;
	setOptionGroupsForSessionType(chatSessionType: string, handle: number, optionGroups?: readonly IChatSessionProviderOptionGroup[]): void;

	getNewChatSessionInputState(chatSessionType: string, sessionResource: URI): Promise<readonly IChatSessionProviderOptionGroup[] | undefined>;

	createNewChatSessionItem(chatSessionType: string, request: IChatNewSessionRequest, token: CancellationToken): Promise<IChatSessionItem | undefined>;

	notifySessionMaterialized?(sessionResource: URI): void;

	deleteChatSessionItem(sessionResource: URI, token: CancellationToken): Promise<void>;

	registerSessionResourceAlias(untitledResource: URI, realResource: URI): void;

	setMaterializedSessionResource(untitledResource: URI, realResource: URI): void;

	getMaterializedSessionResource(untitledResource: URI): URI | undefined;

	clearMaterializedSessionResource(sessionResource: URI): void;

	fireSessionCommitted(original: URI, committed: URI): void;

	readonly onDidChangeCustomizations: Event<{ readonly chatSessionType: string }>;
	registerCustomizationsProvider(chatSessionType: string, provider: IChatSessionCustomizationsProvider): IDisposable;
	hasCustomizationsProvider(chatSessionType: string): boolean;
	getCustomizations(chatSessionType: string, token: CancellationToken): Promise<IChatSessionCustomizationItemGroup[] | undefined>;
}

export function isSessionInProgressStatus(state: ChatSessionStatus): boolean {
	return state === ChatSessionStatus.InProgress || state === ChatSessionStatus.NeedsInput;
}

export function isIChatSessionFileChange2(obj: unknown): obj is IChatSessionFileChange2 {
	const candidate = obj as IChatSessionFileChange2;
	return candidate && candidate.uri instanceof URI && typeof candidate.insertions === 'number' && typeof candidate.deletions === 'number';
}

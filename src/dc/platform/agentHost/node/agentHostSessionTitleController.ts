/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Limiter } from '../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';
import { ISessionDataService } from '../common/sessionDataService.js';
import { SessionServerToolName } from '../common/serverToolNames.js';
import { ActionType } from '../common/state/sessionActions.js';
import { buildDefaultChatUri, isAhpChatChannel, isDefaultChatUri, type Turn, type URI as ProtocolURI } from '../common/state/sessionState.js';
import { buildConversationContext, renderResponseMarkdown, truncateMiddle } from '../common/agentHostConversationContext.js';
import { AgentHostStateManager } from './agentHostStateManager.js';
import type { GitHubIssueOrPullRequest, IAgentHostOctoKitService } from './shared/agentHostOctoKitService.js';
import { IDardcorRouterService, type IDardcorUtilityChatMessage } from './shared/dardcorRouterService.js';
import { AGENT_HOST_TITLE_SOURCE_AGENT, AGENT_HOST_TITLE_SOURCE_AUTO, AGENT_HOST_TITLE_SOURCE_USER, customChatTitleMetadataKey, customChatTitleSourceMetadataKey, persistSessionMetadata, SESSION_CUSTOM_TITLE_KEY, SESSION_CUSTOM_TITLE_SOURCE_KEY } from './shared/persistSessionMetadata.js';

const MAX_TITLE_LENGTH = 200;
const MAX_ACTIVE_AGENT_FALLBACK_TITLE_LENGTH = 40;
const MAX_TITLE_TOKENS = 32;
const GITHUB_CONTEXT_REQUEST_TIMEOUT = 5_000;
const MAX_CONCURRENT_GITHUB_CONTEXT_REQUESTS = 5;
const MAX_GITHUB_CONTEXT_BODY_CHARS = 4_000;
const MAX_GITHUB_CONTEXT_REFERENCES = 10;
const MAX_TRAILING_HAN_SUFFIX_CODE_UNITS = 6;
const MIN_LATIN_LETTERS_BEFORE_HAN_SUFFIX = 4;
const MIN_LATIN_LETTER_RATIO = 0.8;
const HAN_CHARACTER = /\p{sc=Han}/u;
const TRAILING_HAN_SUFFIX = /(?<!\p{sc=Han})\p{sc=Han}{2,3}$/u;
const GITHUB_ISSUE_OR_PULL_REQUEST_URL_PATTERN = /\bhttps?:\/\/(?<host>[\w.-]+)\/(?<owner>[\w.-]+)\/(?<repo>[\w.-]+)\/(?<kind>issues|pull)\/(?<number>\d+)\b/gi;
const CHAT_RENAME_REMINDER = 'Reminder: This chat currently has an auto-generated or placeholder title. If the user references an issue or PR, fetch it first. Please give the chat a short, descriptive title based on the user\'s intent by calling `rename_chat` with `automatic: true`, silently and without a preamble. The user must not know that you are renaming. Do not skip it.';

const MAX_TITLE_CONTEXT_CHARS = 20000;

const MIN_GITHUB_CONTEXT_CHARS = 4_000;

type GitHubReferenceKind = 'issue' | 'pull request';

interface IGitHubReference {
	readonly owner: string;
	readonly repo: string;
	readonly number: number;
	readonly kind: GitHubReferenceKind;
}

interface IGitHubReferenceContext {
	readonly reference: IGitHubReference;
	readonly value: GitHubIssueOrPullRequest;
}

interface ITitlePromptContext {
	readonly content: string;
	readonly isConversation: boolean;
	readonly gitHubReferenceSource?: string;
	readonly currentTitle?: string;
}

export interface IAgentHostSessionTitleControllerOptions {
	readonly sessionDataService: ISessionDataService;
	readonly getGitHubToken?: () => string | undefined;
	readonly getGitHubHost?: () => string | undefined;
	readonly gitHubContextRequestTimeout?: number;
	readonly octoKitService?: IAgentHostOctoKitService;
	readonly dardcorRouterService?: IDardcorRouterService;
	readonly isActiveAgentTitleGenerationEnabled?: () => boolean;
}

export const IAgentHostSessionTitleController = createDecorator<IAgentHostSessionTitleController>('agentHostSessionTitleController');

export interface IAgentHostSessionTitleController {
	readonly _serviceBrand: undefined;
	seedTitleFromFirstMessage(channel: ProtocolURI, userPrompt: string, chatChannel?: ProtocolURI): void;
	seedProvisionalTitle(channel: ProtocolURI, suggestedTitle: string, chatChannel?: ProtocolURI): void;
	refineTitleFromFirstTurn(channel: ProtocolURI, chatChannel?: ProtocolURI): void;
	generateForkedTitle(channel: ProtocolURI, chatChannel: ProtocolURI | undefined, turns: readonly Turn[], fallbackTitle: string, sourceTitle?: string): void;
	generateExternalSessionTitle(session: ProtocolURI, userPrompt: string): Promise<void>;
	cancelTitleGeneration(session: ProtocolURI): void;
	clearSession(session: ProtocolURI, chatChannels: readonly ProtocolURI[]): void;
	markTitleAuto(channel: ProtocolURI, chatChannel: ProtocolURI | undefined, title: string): void;
	markTitleRenamed(channel: ProtocolURI, chatChannel?: ProtocolURI): void;
	prepareInstructionForAgent(channel: ProtocolURI, chatChannel: ProtocolURI): Promise<string | undefined>;
}

export class AgentHostSessionTitleController extends Disposable implements IAgentHostSessionTitleController {

	declare readonly _serviceBrand: undefined;

	private readonly _titleGenerationCancellationSources = new Map<ProtocolURI, CancellationTokenSource>();

	private readonly _lastAppliedTitle = new Map<ProtocolURI, string>();

	private readonly _provisionalTitles = new Set<ProtocolURI>();
	private readonly _autoTitles = new Set<ProtocolURI>();
	private readonly _renamedTitles = new Set<ProtocolURI>();

	constructor(
		private readonly _stateManager: AgentHostStateManager,
		private readonly _options: IAgentHostSessionTitleControllerOptions,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	seedTitleFromFirstMessage(channel: ProtocolURI, userPrompt: string, chatChannel?: ProtocolURI): void {
		if (this._isEphemeralSession(channel)) {
			return;
		}
		const activeAgentTitleGenerationEnabled = this._isActiveAgentTitleGenerationEnabled(channel);
		const fallbackTitle = activeAgentTitleGenerationEnabled
			? this._normalizeActiveAgentFallbackTitle(userPrompt)
			: this._normalizeTitle(userPrompt);
		if (!fallbackTitle) {
			return;
		}

		const independentChat = this._independentChatChannel(channel, chatChannel);
		const key = independentChat ?? channel;
		const state = independentChat ? this._stateManager.getChatState(independentChat) : this._stateManager.getSessionState(channel);
		if (!state || !this._canSeedFirstMessageTitle(key, state.turns.length, state.title)) {
			return;
		}
		const replacesProvisionalTitle = this._provisionalTitles.has(key);
		this._provisionalTitles.delete(key);
		this._applySeedTitle(channel, independentChat, fallbackTitle);
		if (activeAgentTitleGenerationEnabled) {
			this.markTitleAuto(channel, independentChat, fallbackTitle);
			return;
		}
		if (replacesProvisionalTitle) {
			this._persistAutoTitle(channel, independentChat, fallbackTitle);
		}
		this._generateTitleSoon(
			key,
			{ content: userPrompt, isConversation: false, gitHubReferenceSource: userPrompt },
			fallbackTitle,
			title => this._applySeedTitle(channel, independentChat, title),
			() => this._currentSeedTitle(channel, independentChat) === this._lastAppliedTitle.get(key),
			title => this._persistAutoTitle(channel, independentChat, title),
		);
	}

	seedProvisionalTitle(channel: ProtocolURI, suggestedTitle: string, chatChannel?: ProtocolURI): void {
		if (this._isEphemeralSession(channel)) {
			return;
		}
		const title = this._normalizeTitle(suggestedTitle, this._isActiveAgentTitleGenerationEnabled(channel) ? MAX_ACTIVE_AGENT_FALLBACK_TITLE_LENGTH : MAX_TITLE_LENGTH);
		if (!title) {
			return;
		}

		const independentChat = this._independentChatChannel(channel, chatChannel);
		const key = independentChat ?? channel;
		const state = independentChat ? this._stateManager.getChatState(independentChat) : this._stateManager.getSessionState(channel);
		if (!state || !this._canSeedProvisionalTitle(key, state.title)) {
			return;
		}
		this._provisionalTitles.add(key);
		this._applySeedTitle(channel, independentChat, title);
		this._persistAutoTitle(channel, independentChat, title);
	}

	private _normalizeTitle(text: string, maxLength = MAX_TITLE_LENGTH): string {
		return Array.from(text.trim().replace(/\s+/g, ' ')).slice(0, maxLength).join('').trim();
	}

	private _normalizeActiveAgentFallbackTitle(text: string): string {
		const normalized = text.trim().replace(/\s+/g, ' ');
		const characters = Array.from(normalized);
		if (characters.length <= MAX_ACTIVE_AGENT_FALLBACK_TITLE_LENGTH) {
			return normalized;
		}
		const limited = characters.slice(0, MAX_ACTIVE_AGENT_FALLBACK_TITLE_LENGTH).join('');
		if (!limited.includes(' ')) {
			return `${Array.from(limited).slice(0, MAX_ACTIVE_AGENT_FALLBACK_TITLE_LENGTH - 3).join('')}...`;
		}
		const remaining = characters.slice(MAX_ACTIVE_AGENT_FALLBACK_TITLE_LENGTH).join('');
		const nextWordBoundary = remaining.indexOf(' ');
		const completedWord = nextWordBoundary >= 0 ? remaining.slice(0, nextWordBoundary) : remaining;
		if (Array.from(completedWord).length > MAX_ACTIVE_AGENT_FALLBACK_TITLE_LENGTH) {
			return `${Array.from(limited).slice(0, MAX_ACTIVE_AGENT_FALLBACK_TITLE_LENGTH - 3).join('')}...`;
		}
		return nextWordBoundary >= 0
			? `${limited}${completedWord}...`
			: normalized;
	}

	private _independentChatChannel(channel: ProtocolURI, chatChannel?: ProtocolURI): ProtocolURI | undefined {
		if (!chatChannel || !isAhpChatChannel(chatChannel)) {
			return undefined;
		}
		return !isDefaultChatUri(chatChannel) || (this._stateManager.getSessionState(channel)?.chats.length ?? 1) > 1
			? chatChannel
			: undefined;
	}

	private _applySeedTitle(channel: ProtocolURI, independentChat: ProtocolURI | undefined, title: string): void {
		if (independentChat) {
			this._applyTitle(independentChat, title, t => this._stateManager.updateChatTitle(channel, independentChat, t));
			this._persistAutoTitleSource(channel, independentChat);
		} else {
			this._applyTitle(channel, title, t => this._stateManager.dispatchServerAction(channel, {
				type: ActionType.SessionTitleChanged,
				title: t,
			}));
			this._persistAutoTitleSource(channel, undefined);
		}
	}

	private _persistAutoTitle(channel: ProtocolURI, independentChat: ProtocolURI | undefined, title: string): void {
		if (independentChat) {
			this._persistSessionFlag(channel, customChatTitleMetadataKey(independentChat), title);
			this._persistSessionFlag(channel, customChatTitleSourceMetadataKey(independentChat), AGENT_HOST_TITLE_SOURCE_AUTO);
			return;
		}
		this._persistSessionFlag(channel, SESSION_CUSTOM_TITLE_KEY, title);
		this._persistSessionFlag(channel, SESSION_CUSTOM_TITLE_SOURCE_KEY, AGENT_HOST_TITLE_SOURCE_AUTO);
	}

	private _persistAutoTitleSource(channel: ProtocolURI, independentChat: ProtocolURI | undefined): void {
		this._persistSessionFlag(channel, independentChat ? customChatTitleSourceMetadataKey(independentChat) : SESSION_CUSTOM_TITLE_SOURCE_KEY, AGENT_HOST_TITLE_SOURCE_AUTO);
	}

	private _currentSeedTitle(channel: ProtocolURI, independentChat: ProtocolURI | undefined): string | undefined {
		return independentChat ? this._stateManager.getChatState(independentChat)?.title : this._stateManager.getSessionState(channel)?.title;
	}

	private _canSeedFirstMessageTitle(key: ProtocolURI, turnsLength: number, currentTitle: string | undefined): boolean {
		if (turnsLength === 0 && !currentTitle) {
			return true;
		}
		return this._provisionalTitles.has(key) && !!currentTitle && currentTitle === this._lastAppliedTitle.get(key);
	}

	private _canSeedProvisionalTitle(key: ProtocolURI, currentTitle: string | undefined): boolean {
		if (!currentTitle) {
			return true;
		}
		return this._provisionalTitles.has(key) && currentTitle === this._lastAppliedTitle.get(key);
	}

	refineTitleFromFirstTurn(channel: ProtocolURI, chatChannel?: ProtocolURI): void {
		if (this._isEphemeralSession(channel)) {
			return;
		}
		if (this._isActiveAgentTitleGenerationEnabled(channel)) {
			return;
		}
		const isAdditionalChat = !!chatChannel && isAhpChatChannel(chatChannel) && !isDefaultChatUri(chatChannel);
		if (isAdditionalChat) {
			const chatState = this._stateManager.getChatState(chatChannel);
			if (!chatState || chatState.turns.length !== 1) {
				return;
			}
			const lastApplied = this._lastAppliedTitle.get(chatChannel);
			if (lastApplied === undefined || chatState.title !== lastApplied) {
				return;
			}
			const turn = chatState.turns[0];
			const context = this._buildFirstTurnContext(turn);
			if (!context) {
				return;
			}
			const apply = (title: string) => {
				this._applyTitle(chatChannel, title, t => this._stateManager.updateChatTitle(channel, chatChannel, t));
				this._persistAutoTitleSource(channel, chatChannel);
			};
			this._generateTitleSoon(
				chatChannel,
				{ content: context, isConversation: true, gitHubReferenceSource: turn.message.text, currentTitle: lastApplied },
				lastApplied,
				apply,
				() => this._stateManager.getChatState(chatChannel)?.title === this._lastAppliedTitle.get(chatChannel),
				title => this._persistAutoTitle(channel, chatChannel, title),
			);
			return;
		}

		const state = this._stateManager.getSessionState(channel);
		if (!state || state.turns.length !== 1) {
			return;
		}
		const lastApplied = this._lastAppliedTitle.get(channel);
		if (lastApplied === undefined || state.title !== lastApplied) {
			return;
		}
		const turn = state.turns[0];
		const context = this._buildFirstTurnContext(turn);
		if (!context) {
			return;
		}
		const apply = (title: string) => {
			this._applyTitle(channel, title, t => this._stateManager.dispatchServerAction(channel, {
				type: ActionType.SessionTitleChanged,
				title: t,
			}));
			this._persistAutoTitleSource(channel, undefined);
		};
		this._generateTitleSoon(
			channel,
			{ content: context, isConversation: true, gitHubReferenceSource: turn.message.text, currentTitle: lastApplied },
			lastApplied,
			apply,
			() => this._stateManager.getSessionState(channel)?.title === this._lastAppliedTitle.get(channel),
			title => this._persistAutoTitle(channel, undefined, title),
		);
	}

	generateForkedTitle(channel: ProtocolURI, chatChannel: ProtocolURI | undefined, turns: readonly Turn[], fallbackTitle: string, sourceTitle?: string): void {
		if (this._isEphemeralSession(channel)) {
			return;
		}
		if (this._isActiveAgentTitleGenerationEnabled(channel)) {
			this.markTitleAuto(channel, chatChannel, fallbackTitle);
			return;
		}
		const context = this._buildConversationContext(turns, sourceTitle);
		if (!context) {
			return;
		}

		const isAdditionalChat = !!chatChannel && isAhpChatChannel(chatChannel) && !isDefaultChatUri(chatChannel);
		if (isAdditionalChat) {
			const key = chatChannel;
			this._lastAppliedTitle.set(key, fallbackTitle);
			this._persistAutoTitleSource(channel, key);
			const apply = (title: string) => this._applyTitle(key, title, t => this._stateManager.updateChatTitle(channel, key, t));
			this._generateTitleSoon(
				key,
				{ content: context, isConversation: true },
				fallbackTitle,
				apply,
				() => this._stateManager.getChatState(key)?.title === this._lastAppliedTitle.get(key),
				title => this._persistAutoTitle(channel, key, title),
			);
			return;
		}

		this._lastAppliedTitle.set(channel, fallbackTitle);
		this._persistAutoTitleSource(channel, undefined);
		const apply = (title: string) => this._applyTitle(channel, title, t => this._stateManager.dispatchServerAction(channel, {
			type: ActionType.SessionTitleChanged,
			title: t,
		}));
		this._generateTitleSoon(
			channel,
			{ content: context, isConversation: true },
			fallbackTitle,
			apply,
			() => this._stateManager.getSessionState(channel)?.title === this._lastAppliedTitle.get(channel),
			title => this._persistAutoTitle(channel, undefined, title),
		);
	}

	private _applyTitle(key: ProtocolURI, title: string, dispatch: (title: string) => void): void {
		this._lastAppliedTitle.set(key, title);
		dispatch(title);
	}

	async generateExternalSessionTitle(session: ProtocolURI, userPrompt: string): Promise<void> {
		if (this._isEphemeralSession(session) || await this._readPersistedTitleMetadata(session, SESSION_CUSTOM_TITLE_KEY)) {
			return;
		}
		await this._startTitleGeneration(
			session,
			{ content: userPrompt, isConversation: false, gitHubReferenceSource: userPrompt },
			'',
			title => this._applyExternalSessionTitle(session, title),
			() => true,
			title => this._persistAutoTitle(session, undefined, title),
		);
	}

	private _applyExternalSessionTitle(session: ProtocolURI, title: string): void {
		if (this._stateManager.getSessionState(session)) {
			this._applySeedTitle(session, undefined, title);
		} else {
			this._applyTitle(session, title, t => this._stateManager.updateSurfacedSessionTitle(session, t));
		}
	}

	cancelTitleGeneration(session: ProtocolURI): void {
		this._cancelTitleGeneration(session);
	}

	clearSession(session: ProtocolURI, chatChannels: readonly ProtocolURI[]): void {
		for (const key of [session, buildDefaultChatUri(session), ...chatChannels]) {
			this._cancelTitleGeneration(key);
			this._lastAppliedTitle.delete(key);
			this._provisionalTitles.delete(key);
			this._autoTitles.delete(key);
			this._renamedTitles.delete(key);
		}
	}

	markTitleAuto(channel: ProtocolURI, chatChannel: ProtocolURI | undefined, title: string): void {
		const independentChat = this._independentChatChannel(channel, chatChannel);
		const key = independentChat ?? channel;
		this._lastAppliedTitle.set(key, title);
		this._autoTitles.add(key);
		this._renamedTitles.delete(key);
		this._persistAutoTitle(channel, independentChat, title);
	}

	markTitleRenamed(channel: ProtocolURI, chatChannel?: ProtocolURI): void {
		const key = this._independentChatChannel(channel, chatChannel) ?? channel;
		this._cancelTitleGeneration(key);
		this._autoTitles.delete(key);
		this._provisionalTitles.delete(key);
		this._renamedTitles.add(key);
	}

	async prepareInstructionForAgent(channel: ProtocolURI, chatChannel: ProtocolURI): Promise<string | undefined> {
		if (this._isEphemeralSession(channel)) {
			return undefined;
		}
		if (!this._isActiveAgentTitleGenerationEnabled(channel)) {
			return undefined;
		}
		const independentChat = this._independentChatChannel(channel, chatChannel);
		const key = independentChat ?? channel;
		if (this._renamedTitles.has(key)) {
			return undefined;
		}
		const sourceKey = independentChat ? customChatTitleSourceMetadataKey(independentChat) : SESSION_CUSTOM_TITLE_SOURCE_KEY;
		const source = await this._readPersistedTitleMetadata(channel, sourceKey);
		if (source === AGENT_HOST_TITLE_SOURCE_USER || source === AGENT_HOST_TITLE_SOURCE_AGENT) {
			this.markTitleRenamed(channel, independentChat);
			return undefined;
		}
		if (source !== AGENT_HOST_TITLE_SOURCE_AUTO && !this._autoTitles.has(key)) {
			return undefined;
		}

		return CHAT_RENAME_REMINDER;
	}

	private _generateTitleSoon(
		key: ProtocolURI,
		prompt: ITitlePromptContext,
		fallbackTitle: string,
		apply: (title: string) => void,
		currentTitleMatchesFallback: () => boolean,
		persist: (title: string) => void,
	): void {
		void this._startTitleGeneration(key, prompt, fallbackTitle, apply, currentTitleMatchesFallback, persist);
	}

	private _startTitleGeneration(
		key: ProtocolURI,
		prompt: ITitlePromptContext,
		fallbackTitle: string,
		apply: (title: string) => void,
		currentTitleMatchesFallback: () => boolean,
		persist: (title: string) => void,
	): Promise<void> {
		this._cancelTitleGeneration(key);
		const source = new CancellationTokenSource();
		this._titleGenerationCancellationSources.set(key, source);
		return this._generateTitle(key, prompt, fallbackTitle, apply, currentTitleMatchesFallback, persist, source.token).catch(err => {
			if (!source.token.isCancellationRequested) {
				this._logService.warn(`[AgentHostSessionTitleController] Failed to apply generated title for ${key}`, err);
			}
		}).finally(() => {
			if (this._titleGenerationCancellationSources.get(key) === source) {
				this._titleGenerationCancellationSources.delete(key);
				source.dispose();
			}
		});
	}

	private async _generateTitle(
		key: ProtocolURI,
		prompt: ITitlePromptContext,
		fallbackTitle: string,
		apply: (title: string) => void,
		currentTitleMatchesFallback: () => boolean,
		persist: (title: string) => void,
		token: CancellationToken,
	): Promise<void> {
		const generatedTitle = await this._generateTitleFromPrompt(prompt, token);
		if (token.isCancellationRequested || !generatedTitle) {
			return;
		}

		if (!currentTitleMatchesFallback()) {
			return;
		}

		if (generatedTitle !== fallbackTitle) {
			apply(generatedTitle);
		}
		persist(generatedTitle);
	}

	private async _generateTitleFromPrompt(prompt: ITitlePromptContext, token: CancellationToken): Promise<string | undefined> {
		if (token.isCancellationRequested) {
			return undefined;
		}

		const dardcorRouterService = this._options.dardcorRouterService;
		if (!dardcorRouterService) {
			return undefined;
		}

		const abortController = new AbortController();
		const cancellationListener = token.onCancellationRequested(() => abortController.abort());
		try {
			const titlePromptContent = prompt.gitHubReferenceSource === undefined
				? prompt.content
				: await this._appendGitHubContext(prompt.content, prompt.gitHubReferenceSource, abortController.signal, token);
			if (token.isCancellationRequested) {
				return undefined;
			}
			const rawTitle = await dardcorRouterService.utilityChatCompletion({
				messages: this._buildTitlePrompt(titlePromptContent, prompt),
				maxTokens: MAX_TITLE_TOKENS,
			}, {
				signal: abortController.signal,
			});
			return this._cleanTitle(rawTitle, titlePromptContent);
		} catch (err) {
			if (token.isCancellationRequested) {
				return undefined;
			}
			this._logService.warn('[AgentHostSessionTitleController] Failed to generate session title', err);
			return undefined;
		} finally {
			cancellationListener.dispose();
		}
	}

	private async _appendGitHubContext(promptContent: string, referenceSource: string, cancellationSignal: AbortSignal, token: CancellationToken): Promise<string> {
		const references = this._parseGitHubReferences(referenceSource);
		const githubToken = this._options.getGitHubToken?.();
		const octoKitService = this._options.octoKitService;
		if (references.length === 0 || !githubToken || !octoKitService) {
			return promptContent;
		}

		const signal = AbortSignal.any([cancellationSignal, AbortSignal.timeout(this._options.gitHubContextRequestTimeout ?? GITHUB_CONTEXT_REQUEST_TIMEOUT)]);
		const limiter = new Limiter<IGitHubReferenceContext | undefined>(MAX_CONCURRENT_GITHUB_CONTEXT_REQUESTS);
		try {
			const contexts = await Promise.all(references.map(reference => limiter.queue(async () => {
				try {
					const value = await octoKitService.getIssueOrPullRequest(
						reference.owner,
						reference.repo,
						reference.number,
						githubToken,
						signal,
					);
					return { reference, value };
				} catch (error) {
					if (!token.isCancellationRequested) {
						this._logService.warn(`[AgentHostSessionTitleController] Failed to fetch GitHub ${reference.kind} ${reference.owner}/${reference.repo}#${reference.number}`, error);
					}
					return undefined;
				}
			})));
			const successfulContexts = contexts.filter(context => context !== undefined);
			if (successfulContexts.length === 0) {
				return promptContent;
			}
			const separator = '\n\n';
			const gitHubBudget = Math.max(MIN_GITHUB_CONTEXT_CHARS, MAX_TITLE_CONTEXT_CHARS - promptContent.length - separator.length);
			const gitHubContext = this._formatGitHubContexts(successfulContexts, gitHubBudget);
			const contentBudget = Math.max(0, MAX_TITLE_CONTEXT_CHARS - gitHubContext.length - separator.length);
			const content = promptContent.length > contentBudget ? truncateMiddle(promptContent, contentBudget) : promptContent;
			return `${content}${separator}${gitHubContext}`;
		} finally {
			limiter.dispose();
		}
	}

	private _parseGitHubReferences(text: string): IGitHubReference[] {
		const references: IGitHubReference[] = [];
		const seen = new Set<string>();
		const configuredHost = this._normalizeGitHubHost(this._options.getGitHubHost?.() ?? 'github.com');
		for (const match of text.matchAll(GITHUB_ISSUE_OR_PULL_REQUEST_URL_PATTERN)) {
			const host = match.groups?.host;
			const owner = match.groups?.owner;
			const repo = match.groups?.repo;
			const rawKind = match.groups?.kind;
			const number = Number(match.groups?.number);
			if (!host || this._normalizeGitHubHost(host) !== configuredHost || !owner || !repo || (rawKind !== 'issues' && rawKind !== 'pull') || !Number.isSafeInteger(number) || number <= 0) {
				continue;
			}
			const kind: GitHubReferenceKind = rawKind === 'issues' ? 'issue' : 'pull request';
			const key = `${owner.toLowerCase()}/${repo.toLowerCase()}/${kind}/${number}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			references.push({ owner, repo, number, kind });
			if (references.length === MAX_GITHUB_CONTEXT_REFERENCES) {
				break;
			}
		}
		return references;
	}

	private _normalizeGitHubHost(host: string): string {
		const normalizedHost = host.toLowerCase();
		return normalizedHost === 'www.github.com' ? 'github.com' : normalizedHost;
	}

	private _formatGitHubContexts(contexts: readonly IGitHubReferenceContext[], budget: number): string {
		const heading = 'GitHub issue and pull request context:\n\n';
		const fixedLength = heading.length + contexts.reduce((length, context, index) => {
			return length + this._formatGitHubContext(context.reference, context.value, '').length + (index === 0 ? 0 : 2);
		}, 0);
		let remainingBodyBudget = Math.max(0, budget - fixedLength);
		const sections = contexts.map((context, index) => {
			const bodyBudget = Math.min(
				MAX_GITHUB_CONTEXT_BODY_CHARS,
				Math.floor(remainingBodyBudget / (contexts.length - index)),
			);
			const body = truncateMiddle(context.value.body, bodyBudget);
			remainingBodyBudget -= body.length;
			return this._formatGitHubContext(context.reference, context.value, body);
		});
		return truncateMiddle(`${heading}${sections.join('\n\n')}`, budget);
	}

	private _formatGitHubContext(reference: IGitHubReference, value: GitHubIssueOrPullRequest, body: string): string {
		return [
			`GitHub ${reference.kind} ${reference.owner}/${reference.repo}#${reference.number}:`,
			`The title of the ${reference.kind} is: ${value.title}`,
			`The body of the ${reference.kind} is:`,
			body,
		].join('\n');
	}

	private _buildTitlePrompt(promptContent: string, prompt: ITitlePromptContext): IDardcorUtilityChatMessage[] {
		const request = prompt.isConversation
			? `Please write a brief title for the following conversation:\n\n${promptContent}`
			: `Please write a brief title for the following request:\n\n${promptContent}`;
		const currentTitle = prompt.currentTitle?.trim();
		const userInstruction = currentTitle
			? `${request}\n\nIts current title is: ${currentTitle}\nReply with that same title unless the text above supports a clearly more accurate one.`
			: request;
		return [
			{
				role: 'system',
				content: [
					'You are an expert in crafting ultra-compact titles for chatbot conversations.',
					'You are presented with a chat request or conversation, and you reply with only a brief title that captures the main topic.',
					'Write the title in sentence case, not title case.',
					'Preserve product names, abbreviations, code symbols, and proper nouns.',
					'Aim for 3-6 words. Prefer the shortest accurate title.',
					'Drop articles like "a", "an", and "the" unless needed for clarity.',
					'Drop filler and generic framing like "help with", "question about", "request for", or "issue with".',
					'Never describe the chat itself as forked, branched, or continued — title only the underlying topic.',
					'Prefer short, concrete synonyms and omit unnecessary words.',
					'Do not wrap the title in quotes or add trailing punctuation.',
				].join(' '),
			},
			{
				role: 'user',
				content: userInstruction,
			},
		];
	}

	private _cleanTitle(rawTitle: string, promptContent: string): string | undefined {
		let title = rawTitle.trim();
		const firstLine = title.split(/\r?\n/).map(line => line.trim()).find(line => line.length > 0);
		title = firstLine ?? '';
		if (title.startsWith('"') && title.endsWith('"') && title.length > 1) {
			title = title.slice(1, -1).trim();
		}
		title = title.replace(/[.!?]+$/, '').trim();

		if (!title || title.includes('can\'t assist with that')) {
			return undefined;
		}
		title = title.slice(0, MAX_TITLE_LENGTH + MAX_TRAILING_HAN_SUFFIX_CODE_UNITS);
		return this._stripUnexpectedTrailingHanSuffix(title, promptContent).slice(0, MAX_TITLE_LENGTH);
	}

	private _stripUnexpectedTrailingHanSuffix(title: string, promptContent: string): string {
		if (HAN_CHARACTER.test(promptContent)) {
			return title;
		}

		const suffix = TRAILING_HAN_SUFFIX.exec(title);
		if (!suffix) {
			return title;
		}

		const prefix = title.slice(0, suffix.index).trimEnd();
		const letterCount = prefix.match(/\p{L}/gu)?.length ?? 0;
		const latinLetterCount = prefix.match(/\p{sc=Latin}/gu)?.length ?? 0;
		if (latinLetterCount < MIN_LATIN_LETTERS_BEFORE_HAN_SUFFIX || latinLetterCount / letterCount < MIN_LATIN_LETTER_RATIO) {
			return title;
		}

		return prefix;
	}

	private _buildFirstTurnContext(turn: Turn): string | undefined {
		const response = renderResponseMarkdown(turn.responseParts);
		if (!response) {
			return undefined;
		}

		const userBudget = Math.floor(MAX_TITLE_CONTEXT_CHARS / 2);
		let userRequest = turn.message.text.trim();
		if (userRequest.length > userBudget) {
			userRequest = truncateMiddle(userRequest, userBudget);
		}
		const userBlock = `User request:\n${userRequest}`;
		const responseLabel = '\n\nAgent response:\n';

		const responseBudget = Math.max(0, MAX_TITLE_CONTEXT_CHARS - userBlock.length - responseLabel.length);
		const trimmedResponse = response.length > responseBudget ? truncateMiddle(response, responseBudget) : response;

		return trimmedResponse ? `${userBlock}${responseLabel}${trimmedResponse}` : userBlock;
	}

	private _buildConversationContext(turns: readonly Turn[], sourceTitle?: string): string | undefined {
		const framedTitle = sourceTitle?.trim();
		const framing = framedTitle
			? `This conversation was branched from an earlier chat titled "${framedTitle}". The turns below, oldest first, are the inherited history up to the branch point.\n\n`
			: undefined;
		return buildConversationContext(turns, { maxChars: MAX_TITLE_CONTEXT_CHARS, framing });
	}

	private _persistSessionFlag(session: ProtocolURI, key: string, value: string): void {
		persistSessionMetadata(this._options.sessionDataService, this._logService, session, key, value);
	}

	private _isActiveAgentTitleGenerationEnabled(channel: ProtocolURI): boolean {
		const serverTools = this._stateManager.getSessionState(channel)?.serverTools;
		return serverTools
			? serverTools.some(tool => tool.name === SessionServerToolName.RenameChat)
			: this._options.isActiveAgentTitleGenerationEnabled?.() === true;
	}

	private _isEphemeralSession(channel: ProtocolURI): boolean {
		return this._stateManager.isEphemeralSession(channel);
	}

	private async _readPersistedTitleMetadata(session: ProtocolURI, key: string): Promise<string | undefined> {
		try {
			const ref = await this._options.sessionDataService.tryOpenDatabase?.(URI.parse(session));
			if (!ref) {
				return undefined;
			}
			try {
				return await ref.object.getMetadata(key);
			} finally {
				ref.dispose();
			}
		} catch (err) {
			this._logService.warn(`[AgentHostSessionTitleController] Failed to read title metadata '${key}'`, err);
			return undefined;
		}
	}

	private _cancelTitleGeneration(session: ProtocolURI): void {
		const source = this._titleGenerationCancellationSources.get(session);
		if (!source) {
			return;
		}
		source.dispose(true);
		this._titleGenerationCancellationSources.delete(session);
	}

	override dispose(): void {
		for (const source of this._titleGenerationCancellationSources.values()) {
			source.dispose(true);
		}
		this._titleGenerationCancellationSources.clear();
		this._lastAppliedTitle.clear();
		this._provisionalTitles.clear();
		this._autoTitles.clear();
		this._renamedTitles.clear();
		super.dispose();
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { escapeModelIdForTelemetry, ITelemetryService, TelemetryLevel } from '../../../../../platform/telemetry/common/telemetry.js';
import { IWorkbenchAssignmentService } from '../../../../services/assignment/common/assignmentService.js';
import { ChatModelFeedbackSurveyStepKind, IChatModelFeedbackSurveyConfig, matchesChatModelFeedbackSurvey, parseChatModelFeedbackSurveyConfig } from '../../common/feedbackSurvey/chatModelFeedbackSurveyConfig.js';
import { expandModelMatchCandidates, modelSelectorAliases } from '../../common/expPayload.js';
import { CHAT_MODEL_FEEDBACK_SURVEY_TELEMETRY_COMMAND_ID, ChatModelFeedbackSurveyEventKind, IChatModelFeedbackSurveyTelemetryEvent } from '../../common/feedbackSurvey/chatModelFeedbackSurveyTelemetry.js';
import { ILanguageModelsService } from '../../common/languageModels.js';
import { getChatSessionType } from '../../common/model/chatUri.js';
import { IChatResponseViewModel } from '../../common/model/chatViewModel.js';
import { IChatSessionsService } from '../../common/chatSessionsService.js';
import { IChatService } from '../../common/chatService/chatService.js';

export const CHAT_MODEL_FEEDBACK_SURVEY_TREATMENT = 'chatModelFeedbackSurvey';

const FEEDBACK_ENABLED_CONFIG = 'telemetry.feedback.enabled';

const STORAGE_PREFIX = 'chat.modelFeedbackSurvey.';

export const enum ChatModelFeedbackSurveyStatus {
	Collapsed = 'collapsed',
	Open = 'open',
}

export type ChatModelFeedbackSurveyOpenTrigger = 'manual' | 'chance' | 'modelSwitchedAway';

export interface IChatModelFeedbackSurveyState {
	readonly config: IChatModelFeedbackSurveyConfig;
	readonly instanceId: string;
	readonly status: ChatModelFeedbackSurveyStatus;
	readonly stepIndex: number;
	readonly answers: ReadonlyMap<string, string>;
	readonly commentDraft: string;
	readonly isSubmitted: boolean;
	readonly openTrigger: ChatModelFeedbackSurveyOpenTrigger | undefined;
}

export interface IChatModelFeedbackSurveyChangeEvent {
	readonly sessionResource: URI;
	readonly requestId: string;
}

export const IChatModelFeedbackSurveyService = createDecorator<IChatModelFeedbackSurveyService>('chatModelFeedbackSurveyService');

export interface IChatModelFeedbackSurveyService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeSurveyState: Event<IChatModelFeedbackSurveyChangeEvent>;

	readonly onDidChangeConfiguration: Event<void>;

	getSurvey(response: IChatResponseViewModel): IChatModelFeedbackSurveyState | undefined;

	toggle(response: IChatResponseViewModel): void;

	notifyModelSwitchedAway(sessionResource: URI, fromModelId: string, toModelId: string): void;
	answerChoice(response: IChatResponseViewModel, stepId: string, optionId: string): void;
	submit(response: IChatResponseViewModel, comment?: string): void;
	dismiss(response: IChatResponseViewModel): void;
	setCommentDraft(response: IChatResponseViewModel, comment: string): void;
}

interface IMutableSurveyState {
	readonly config: IChatModelFeedbackSurveyConfig;
	readonly instanceId: string;
	readonly sessionResource: URI;
	readonly requestId: string;
	status: ChatModelFeedbackSurveyStatus;
	stepIndex: number;
	readonly answers: Map<string, string>;
	commentDraft: string;
	isSubmitted: boolean;
	openTrigger: ChatModelFeedbackSurveyOpenTrigger | undefined;
	readonly dimensions: IChatModelFeedbackSurveyDimensions;
	shownReported: boolean;
	reportedComment?: string;
}

type IChatModelFeedbackSurveyDimensions = Pick<IChatModelFeedbackSurveyTelemetryEvent, 'modelId' | 'resolvedModelId' | 'modeId' | 'harness' | 'sessionType'>;

function isInProgress(state: IMutableSurveyState): boolean {
	return state.status === ChatModelFeedbackSurveyStatus.Open && !state.isSubmitted;
}

export class ChatModelFeedbackSurveyService extends Disposable implements IChatModelFeedbackSurveyService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeSurveyState = this._register(new Emitter<IChatModelFeedbackSurveyChangeEvent>());
	readonly onDidChangeSurveyState: Event<IChatModelFeedbackSurveyChangeEvent> = this._onDidChangeSurveyState.event;

	private readonly _onDidChangeConfiguration = this._register(new Emitter<void>());
	readonly onDidChangeConfiguration: Event<void> = this._onDidChangeConfiguration.event;

	private _config: IChatModelFeedbackSurveyConfig | undefined;
	private _configResolved = false;
	private _configGeneration = 0;

	private readonly _states = new Map<string, IMutableSurveyState>();
	private readonly _sessionPromptCounts = new Map<string, number>();
	private readonly _lastSurveyedResponse = new Map<string, string>();

	constructor(
		@IWorkbenchAssignmentService private readonly assignmentService: IWorkbenchAssignmentService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ICommandService private readonly commandService: ICommandService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@IChatSessionsService private readonly chatSessionsService: IChatSessionsService,
		@IChatService private readonly chatService: IChatService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		void this.resolveConfig();
		this._register(this.assignmentService.onDidRefetchAssignments(() => void this.resolveConfig()));
		this._register(this.chatService.onDidDisposeSession(e => this.forgetSessions(e.sessionResources)));
	}

	private async resolveConfig(): Promise<void> {
		const generation = ++this._configGeneration;
		let payload: string | undefined;
		try {
			payload = await this.assignmentService.getTreatment<string>(CHAT_MODEL_FEEDBACK_SURVEY_TREATMENT);
		} catch (err) {
			this.logService.trace(`[chatModelFeedbackSurvey] failed to resolve treatment: ${err}`);
		}

		if (generation !== this._configGeneration) {
			return;
		}

		const previousId = this._config?.id;
		if (payload === undefined) {
			this._config = undefined;
		} else {
			const result = parseChatModelFeedbackSurveyConfig(payload);
			if (result.error) {
				this.logService.warn(`[chatModelFeedbackSurvey] ignoring invalid survey config: ${result.error}`);
				this._config = undefined;
			} else {
				this._config = result.config;
			}
		}
		this._configResolved = true;

		if (this._config && this._config.id !== previousId) {
			this._states.clear();
			this._sessionPromptCounts.clear();
			this._lastSurveyedResponse.clear();
		}

		if (this._config?.id !== previousId) {
			this._onDidChangeConfiguration.fire();
		}
	}

	getSurvey(response: IChatResponseViewModel): IChatModelFeedbackSurveyState | undefined {
		const key = this.getKey(response);
		const existing = this._states.get(key);
		if (existing) {
			const stillApplies = this._config?.id === existing.config.id && this.isFeedbackUiEnabled();
			if (!stillApplies && !isInProgress(existing)) {
				this._states.delete(key);
				return undefined;
			}
			if (!response.isLast && !isInProgress(existing)) {
				this._states.delete(key);
				return undefined;
			}
			this.reportShownOnce(existing);
			return this.toReadonly(existing);
		}

		if (!response.isLast) {
			return undefined;
		}

		this.dropSupersededStates(response.sessionResource, key);

		const config = this.getMatchingConfig(response);
		if (!config) {
			return undefined;
		}

		const state: IMutableSurveyState = {
			config,
			instanceId: generateUuid(),
			sessionResource: response.sessionResource,
			requestId: response.requestId,
			status: ChatModelFeedbackSurveyStatus.Collapsed,
			stepIndex: 0,
			answers: new Map(),
			commentDraft: '',
			isSubmitted: false,
			openTrigger: undefined,
			dimensions: this.readDimensions(response),
			shownReported: false,
		};
		this._states.set(key, state);
		this._lastSurveyedResponse.set(response.sessionResource.toString(), key);
		this.reportShownOnce(state);

		if (this.shouldPromptByChance(state)) {
			this.beginPrompt(state, 'chance', false);
		}

		return this.toReadonly(state);
	}

	toggle(response: IChatResponseViewModel): void {
		const state = this._states.get(this.getKey(response));
		if (!state) {
			return;
		}
		if (state.status === ChatModelFeedbackSurveyStatus.Open) {
			this.dismiss(response);
		} else {
			this.openState(state, 'manual');
		}
	}

	notifyModelSwitchedAway(sessionResource: URI, fromModelId: string, toModelId: string): void {
		const key = this._lastSurveyedResponse.get(sessionResource.toString());
		const state = key ? this._states.get(key) : undefined;
		if (!state || state.status === ChatModelFeedbackSurveyStatus.Open || state.isSubmitted) {
			return;
		}

		if (!this.isSurveyedModel(state.config, fromModelId) || this.isSurveyedModel(state.config, toModelId)) {
			return;
		}

		const trigger = state.config.prompt.triggers.modelSwitchedAway;
		if (!trigger.enabled || this.hasSurveyInProgress() || !this.hasPromptBudget(state, trigger.bypassCooldown)) {
			return;
		}

		this.beginPrompt(state, 'modelSwitchedAway');
	}

	private isSurveyedModel(config: IChatModelFeedbackSurveyConfig, modelId: string): boolean {
		const selectors = config.match.selectedModels;
		if (!selectors.length) {
			return false;
		}
		const candidates = expandModelMatchCandidates(modelId, this.getModelAliases(modelId));
		return selectors.some(selector => candidates.has(selector));
	}

	private getModelAliases(modelId: string | undefined): string[] | undefined {
		const metadata = modelId ? this.languageModelsService.lookupLanguageModel(modelId) : undefined;
		return metadata ? modelSelectorAliases(metadata) : undefined;
	}

	answerChoice(response: IChatResponseViewModel, stepId: string, optionId: string): void {
		const state = this._states.get(this.getKey(response));
		if (!state || state.status !== ChatModelFeedbackSurveyStatus.Open || state.isSubmitted) {
			return;
		}

		const stepIndex = state.config.steps.findIndex(step => step.id === stepId);
		const step = state.config.steps[stepIndex];
		if (!step || step.kind !== ChatModelFeedbackSurveyStepKind.Choice) {
			return;
		}
		if (!step.options.some(option => option.id === optionId)) {
			return;
		}

		state.answers.set(stepId, optionId);
		this.report(state, 'step', { stepId, stepIndex, answerId: optionId });

		const isLastStep = stepIndex === state.config.steps.length - 1;
		if (isLastStep) {
			this.finish(state, true, 'submitted');
			return;
		}

		state.stepIndex = stepIndex + 1;
		this._onDidChangeSurveyState.fire(this.toChangeEvent(state));
	}

	submit(response: IChatResponseViewModel, comment?: string): void {
		const state = this._states.get(this.getKey(response));
		if (!state || state.status !== ChatModelFeedbackSurveyStatus.Open || state.isSubmitted) {
			return;
		}

		this.reportCommentOnce(state, comment);
		this.finish(state, true, 'submitted');
	}

	dismiss(response: IChatResponseViewModel): void {
		const state = this._states.get(this.getKey(response));
		if (!state || state.status !== ChatModelFeedbackSurveyStatus.Open) {
			return;
		}

		if (state.isSubmitted) {
			state.status = ChatModelFeedbackSurveyStatus.Collapsed;
			this._onDidChangeSurveyState.fire(this.toChangeEvent(state));
			return;
		}

		this.reportCommentOnce(state, state.commentDraft);
		this.finish(state, false, 'dismissed');
	}

	setCommentDraft(response: IChatResponseViewModel, comment: string): void {
		const state = this._states.get(this.getKey(response));
		if (!state || state.status !== ChatModelFeedbackSurveyStatus.Open) {
			return;
		}
		state.commentDraft = comment;
	}


	private shouldPromptByChance(state: IMutableSurveyState): boolean {
		const { chance } = state.config.prompt;
		if (chance.initial <= 0 && chance.increment <= 0) {
			return false;
		}
		if (this.hasSurveyInProgress()) {
			return false;
		}
		if (!this.hasPromptBudget(state, false)) {
			return false;
		}

		const misses = this.readPromptMisses(state.config);
		const probability = Math.min(chance.initial + (chance.increment * misses), chance.max);
		if (Math.random() < probability) {
			return true;
		}

		this.writePromptMisses(state.config, misses + 1);
		return false;
	}

	private forgetSessions(sessionResources: readonly URI[]): void {
		for (const sessionResource of sessionResources) {
			const session = sessionResource.toString();
			this._sessionPromptCounts.delete(session);
			this._lastSurveyedResponse.delete(session);
			for (const [key, state] of [...this._states]) {
				if (state.sessionResource.toString() === session) {
					this._states.delete(key);
				}
			}
		}
	}

	private hasSurveyInProgress(): boolean {
		for (const state of this._states.values()) {
			if (isInProgress(state)) {
				return true;
			}
		}
		return false;
	}

	private hasPromptBudget(state: IMutableSurveyState, bypassCooldown: boolean): boolean {
		const { prompt } = state.config;
		const sessionKey = state.sessionResource.toString();
		if ((this._sessionPromptCounts.get(sessionKey) ?? 0) >= prompt.maxPerSession) {
			return false;
		}
		if (bypassCooldown || prompt.cooldownDays <= 0) {
			return true;
		}

		const lastPromptAt = this.readLastPromptAt(state.config);
		if (lastPromptAt === undefined) {
			return true;
		}
		return Date.now() - lastPromptAt >= prompt.cooldownDays * 24 * 60 * 60 * 1000;
	}

	private beginPrompt(state: IMutableSurveyState, trigger: ChatModelFeedbackSurveyOpenTrigger, announce = true): void {
		const sessionKey = state.sessionResource.toString();
		this._sessionPromptCounts.set(sessionKey, (this._sessionPromptCounts.get(sessionKey) ?? 0) + 1);
		this.writeLastPromptAt(state.config, Date.now());
		this.writePromptMisses(state.config, 0);
		this.openState(state, trigger, announce);
	}

	private openState(state: IMutableSurveyState, trigger: ChatModelFeedbackSurveyOpenTrigger, announce = true): void {
		this.closeOtherOpenSurveys(state);
		if (!state.isSubmitted && state.stepIndex >= state.config.steps.length) {
			state.stepIndex = 0;
		}
		state.status = ChatModelFeedbackSurveyStatus.Open;
		state.openTrigger = trigger;
		if (!state.isSubmitted) {
			this.report(state, 'opened', { trigger });
		}
		if (announce) {
			this._onDidChangeSurveyState.fire(this.toChangeEvent(state));
		}
	}

	private finish(state: IMutableSurveyState, submitted: boolean, kind: ChatModelFeedbackSurveyEventKind): void {
		const stepIndex = state.stepIndex;
		state.isSubmitted = submitted;
		state.status = submitted ? ChatModelFeedbackSurveyStatus.Open : ChatModelFeedbackSurveyStatus.Collapsed;
		this.report(state, kind, { stepIndex });
		this._onDidChangeSurveyState.fire(this.toChangeEvent(state));
	}

	private toChangeEvent(state: IMutableSurveyState): IChatModelFeedbackSurveyChangeEvent {
		return { sessionResource: state.sessionResource, requestId: state.requestId };
	}


	private getMatchingConfig(response: IChatResponseViewModel): IChatModelFeedbackSurveyConfig | undefined {
		if (!this._configResolved || !this._config) {
			return undefined;
		}
		if (!this.isFeedbackUiEnabled()) {
			return undefined;
		}
		if (!response.isComplete || response.isCanceled || response.errorDetails) {
			return undefined;
		}

		const request = response.model.request;
		const selectedModelId = request?.modelId;

		return matchesChatModelFeedbackSurvey(this._config, {
			selectedModelId,
			selectedModelAliases: this.getModelAliases(selectedModelId),
			resolvedModelId: this.getResolvedModelId(response),
			modeId: request?.modeInfo?.telemetryModeId,
			harness: this.getHarness(response.sessionResource),
			sessionType: getChatSessionType(response.sessionResource),
		}) ? this._config : undefined;
	}

	private isFeedbackUiEnabled(): boolean {
		return this.configurationService.getValue<boolean>(FEEDBACK_ENABLED_CONFIG) !== false
			&& this.telemetryService.telemetryLevel !== TelemetryLevel.NONE;
	}

	private getResolvedModelId(response: IChatResponseViewModel): string | undefined {
		const resolvedModel = response.result?.metadata?.resolvedModel;
		return typeof resolvedModel === 'string' ? resolvedModel : undefined;
	}

	private getHarness(sessionResource: URI): string | undefined {
		return this.chatSessionsService.getChatSessionContribution(getChatSessionType(sessionResource))?.agentHostProviderId;
	}


	private readPromptMisses(config: IChatModelFeedbackSurveyConfig): number {
		const value = this.storageService.getNumber(`${STORAGE_PREFIX}${config.id}.promptMisses`, StorageScope.PROFILE, 0);
		return Number.isFinite(value) && value > 0 ? value : 0;
	}

	private writePromptMisses(config: IChatModelFeedbackSurveyConfig, misses: number): void {
		this.storageService.store(`${STORAGE_PREFIX}${config.id}.promptMisses`, misses, StorageScope.PROFILE, StorageTarget.MACHINE);
	}

	private readLastPromptAt(config: IChatModelFeedbackSurveyConfig): number | undefined {
		const value = this.storageService.getNumber(`${STORAGE_PREFIX}${config.id}.lastPromptAt`, StorageScope.PROFILE);
		return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
	}

	private writeLastPromptAt(config: IChatModelFeedbackSurveyConfig, timestamp: number): void {
		this.storageService.store(`${STORAGE_PREFIX}${config.id}.lastPromptAt`, timestamp, StorageScope.PROFILE, StorageTarget.MACHINE);
	}


	private getKey(response: IChatResponseViewModel): string {
		return `${response.sessionResource.toString()}\u0000${response.requestId}`;
	}

	private toReadonly(state: IMutableSurveyState): IChatModelFeedbackSurveyState {
		return {
			config: state.config,
			instanceId: state.instanceId,
			status: state.status,
			stepIndex: state.stepIndex,
			answers: state.answers,
			commentDraft: state.commentDraft,
			isSubmitted: state.isSubmitted,
			openTrigger: state.openTrigger,
		};
	}

	private closeOtherOpenSurveys(keep: IMutableSurveyState): void {
		for (const other of [...this._states.values()]) {
			if (other === keep || other.status !== ChatModelFeedbackSurveyStatus.Open) {
				continue;
			}
			other.status = ChatModelFeedbackSurveyStatus.Collapsed;
			this._onDidChangeSurveyState.fire(this.toChangeEvent(other));
		}
	}

	private dropSupersededStates(sessionResource: URI, currentKey: string): void {
		const session = sessionResource.toString();
		for (const [key, state] of [...this._states]) {
			if (key !== currentKey && state.sessionResource.toString() === session && !isInProgress(state)) {
				this._states.delete(key);
			}
		}
	}


	private reportShownOnce(state: IMutableSurveyState): void {
		if (state.shownReported) {
			return;
		}
		state.shownReported = true;
		this.report(state, 'shown', {});
	}

	private reportCommentOnce(state: IMutableSurveyState, comment: string | undefined): void {
		const textStep = state.config.steps.at(-1);
		if (textStep?.kind !== ChatModelFeedbackSurveyStepKind.Text) {
			return;
		}
		const trimmed = comment?.trim();
		if (!trimmed || trimmed === state.reportedComment) {
			return;
		}

		const clamped = trimmed.slice(0, textStep.maxLength);
		state.reportedComment = trimmed;
		state.answers.set(textStep.id, clamped);
		this.report(state, 'step', {
			stepId: textStep.id,
			stepIndex: state.config.steps.length - 1,
			comment: clamped,
		});
	}

	private readDimensions(response: IChatResponseViewModel): IChatModelFeedbackSurveyDimensions {
		const request = response.model.request;
		return {
			modelId: escapeModelIdForTelemetry(request?.modelId),
			resolvedModelId: escapeModelIdForTelemetry(this.getResolvedModelId(response)),
			modeId: request?.modeInfo?.telemetryModeId,
			harness: this.getHarness(response.sessionResource),
			sessionType: getChatSessionType(response.sessionResource),
		};
	}

	private report(
		state: IMutableSurveyState,
		kind: ChatModelFeedbackSurveyEventKind,
		details: Pick<IChatModelFeedbackSurveyTelemetryEvent, 'stepId' | 'stepIndex' | 'answerId' | 'comment' | 'trigger'>,
	): void {
		if (!this.isFeedbackUiEnabled()) {
			return;
		}

		const event: IChatModelFeedbackSurveyTelemetryEvent = {
			kind,
			surveyId: state.config.id,
			surveyInstanceId: state.instanceId,
			stepCount: state.config.steps.length,
			...details,
			...state.dimensions,
			requestId: state.requestId,
		};

		this.commandService.executeCommand(CHAT_MODEL_FEEDBACK_SURVEY_TELEMETRY_COMMAND_ID, event)
			.catch(err => this.logService.trace(`[chatModelFeedbackSurvey] failed to report '${kind}': ${err}`));
	}
}

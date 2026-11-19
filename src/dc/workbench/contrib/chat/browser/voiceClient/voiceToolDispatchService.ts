/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { constObservable } from '../../../../../base/common/observable.js';
import { localize } from '../../../../../nls.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { IChatPlanReviewResult, IChatQuestionAnswers, IChatQuestionCarousel, IChatSendRequestOptions, IChatService, IChatToolInvocation, ToolConfirmKind } from '../../common/chatService/chatService.js';
import { IBackendQuestionAnswer, resolveQuestionAnswers } from '../../common/voiceClient/voiceQuestionAnswers.js';
import { ChatQuestionCarouselData } from '../../common/model/chatProgressTypes/chatQuestionCarouselData.js';
import { ChatPlanReviewData } from '../../common/model/chatProgressTypes/chatPlanReviewData.js';
import { IChatModel } from '../../common/model/chatModel.js';
import { ILanguageModelChatMetadataAndIdentifier } from '../../common/languageModels.js';
import { ChatAgentLocation, ChatModeKind } from '../../common/constants.js';
import { ILanguageModelToolsService } from '../../common/tools/languageModelToolsService.js';
import { IVoiceDispatchResult, IVoiceModelReference, IVoiceToolCall, markPendingIdResolved, peekPendingId } from '../../common/voiceClient/voiceClientService.js';
import { getVoiceConfirmationType } from '../../common/voiceClient/voiceConfirmation.js';
import { isExplicitFileOrImageVariableEntry } from '../../common/attachments/chatVariableEntries.js';

export interface IVoiceToolDispatchDelegate {
	acceptInput(text: string): boolean;
	getCurrentSessionResource(): Promise<URI | undefined>;
	switchToSession(resource: URI): Promise<boolean>;
	setTargetSession(resource: URI): void;
	getTargetSessionResource(): URI | undefined;
	selectModel(requestedModel: string): Promise<IVoiceModelSelectionResult>;
	attachFiles?(resources: readonly URI[]): Promise<IVoiceAttachmentResult>;
	getAutoApprovedSessions(): Set<string>;
	addAllAutoApprovedSessions(): void;
	removeAutoApprovedSession(resource: string): void;
	triggerAutoApproveCheck(): void;
}

export interface IVoiceAttachmentResult {
	readonly ok: boolean;
	readonly reason?: 'no_input' | 'attachment_failed';
	readonly attached_resources?: readonly string[];
}

export interface IVoiceModelSelectionResult {
	readonly ok: boolean;
	readonly reason?: 'no_input' | 'model_not_found' | 'ambiguous_model' | 'selection_failed';
	readonly selected_model?: IVoiceModelReference;
	readonly available_models?: readonly IVoiceModelReference[];
}

function voiceModelReference(model: ILanguageModelChatMetadataAndIdentifier): IVoiceModelReference {
	return {
		identifier: model.identifier,
		name: model.metadata.name,
		vendor: model.metadata.vendor,
	};
}

function normalizeModelName(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function resolveVoiceModel(models: readonly ILanguageModelChatMetadataAndIdentifier[], requestedModel: string): IVoiceModelSelectionResult & { readonly identifier?: string } {
	const exactIdentifier = models.find(model => model.identifier === requestedModel);
	if (exactIdentifier) {
		return { ok: true, identifier: exactIdentifier.identifier, selected_model: voiceModelReference(exactIdentifier) };
	}

	const normalized = normalizeModelName(requestedModel);
	const exactMatches = models.filter(model => [
		model.metadata.name,
		model.metadata.id,
		model.metadata.family,
		`${model.metadata.name} ${model.metadata.vendor}`,
	].some(candidate => normalizeModelName(candidate) === normalized));
	if (exactMatches.length === 1) {
		return { ok: true, identifier: exactMatches[0].identifier, selected_model: voiceModelReference(exactMatches[0]) };
	}
	if (exactMatches.length > 1) {
		return { ok: false, reason: 'ambiguous_model', available_models: exactMatches.map(voiceModelReference) };
	}

	const related = normalized ? models.filter(model => [model.metadata.name, model.metadata.id, model.metadata.family]
		.some(candidate => normalizeModelName(candidate).includes(normalized) || normalized.includes(normalizeModelName(candidate)))) : [];
	return {
		ok: false,
		reason: related.length > 1 ? 'ambiguous_model' : 'model_not_found',
		available_models: (related.length > 0 ? related : models).slice(0, 10).map(voiceModelReference),
	};
}

export interface IVoiceToolDispatchService {
	readonly _serviceBrand: undefined;

	setDelegate(delegate: IVoiceToolDispatchDelegate): void;

	dispatchToolCall(toolCall: IVoiceToolCall): Promise<string>;

	respondToSession(toolCall: IVoiceToolCall): Promise<IVoiceDispatchResult>;
}

export const IVoiceToolDispatchService = createDecorator<IVoiceToolDispatchService>('voiceToolDispatchService');

const ACTION_LABELS: Record<string, string> = {
	send_to_chat: localize('agentsVoice.action.sendToChat', "Sending to chat..."),
	get_session_info: localize('agentsVoice.action.getSessionInfo', "Checking sessions..."),
	get_session_changes: localize('agentsVoice.action.getSessionChanges', "Checking changes..."),
	get_session_thread: localize('agentsVoice.action.getSessionThread', "Checking conversation..."),
	respond_to_session: localize('agentsVoice.action.respond', "Responding..."),
	focus_session: localize('agentsVoice.action.focusSession', "Focusing session..."),
	set_model: localize('agentsVoice.action.setModel', "Changing model..."),
	auto_approve_session: localize('agentsVoice.action.autoApprove', "Auto-approving session..."),
	revoke_auto_approve: localize('agentsVoice.action.revokeAutoApprove', "Revoking auto-approve..."),
};

export class VoiceToolDispatchService implements IVoiceToolDispatchService {

	declare readonly _serviceBrand: undefined;

	private _delegate: IVoiceToolDispatchDelegate | undefined;

	constructor(
		@IChatService private readonly chatService: IChatService,
		@ILanguageModelToolsService private readonly toolsService: ILanguageModelToolsService,
	) { }

	setDelegate(delegate: IVoiceToolDispatchDelegate): void {
		this._delegate = delegate;
	}

	static getActionLabel(name: string): string {
		return ACTION_LABELS[name] ?? localize('agentsVoice.action.working', "Working...");
	}

	private get _agentModeOptions(): IChatSendRequestOptions {
		const allTools: Record<string, boolean> = {};
		for (const tool of this.toolsService.getTools(undefined)) {
			allTools[tool.id] = true;
		}
		return {
			modeInfo: {
				kind: ChatModeKind.Agent,
				isBuiltin: true,
				modeInstructions: undefined,
				telemetryModeId: 'agent',
				applyCodeBlockSuggestionId: undefined,
			},
			instructionContext: {
				modeKind: ChatModeKind.Agent,
				enabledTools: allTools,
			},
			userSelectedTools: constObservable(allTools),
		};
	}

	async dispatchToolCall(toolCall: IVoiceToolCall): Promise<string> {
		const delegate = this._delegate;
		if (!delegate) {
			return 'error: no delegate set';
		}

		const args = toolCall.args;
		const argString = (k: string): string => {
			const v = args[k];
			return typeof v === 'string' ? v : '';
		};

		switch (toolCall.name) {
			case 'send_to_chat': {
				const text = argString('text');
				if (text) {
					if (!delegate.acceptInput(text)) {
						const resource = await delegate.getCurrentSessionResource();
						if (resource) {
							await this.chatService.sendRequest(resource, text, this._agentModeOptions);
						} else {
							const ref = this.chatService.startNewLocalSession(ChatAgentLocation.Chat);
							await this.chatService.sendRequest(ref.object.sessionResource, text, this._agentModeOptions);
							ref.dispose();
						}
					}
				}
				break;
			}
			case 'focus_session': {
				const targetSessionId = argString('coding_session_id');
				const targetResource = this._findSessionResource(targetSessionId);
				if (targetResource) {
					const currentResource = await delegate.getCurrentSessionResource();
					const switched = targetResource.toString() === currentResource?.toString()
						|| await delegate.switchToSession(targetResource);
					if (switched) {
						delegate.setTargetSession(targetResource);
						return JSON.stringify({ ok: true, session_id: targetResource.toString() });
					}
				}
				return JSON.stringify({ ok: false, reason: targetResource ? 'switch_failed' : 'session_not_found' });
			}
			case 'set_model': {
				const requestedModel = argString('model_id') || argString('model');
				if (!requestedModel) {
					return JSON.stringify({ ok: false, reason: 'model_not_found' });
				}
				const target = await this._showActionTarget(argString('coding_session_id'));
				if (!target.ok) {
					return JSON.stringify(target);
				}
				return JSON.stringify(await delegate.selectModel(requestedModel));
			}
			case 'auto_approve_session': {
				delegate.addAllAutoApprovedSessions();
				break;
			}
			case 'revoke_auto_approve': {
				const sessionResource = await delegate.getCurrentSessionResource();
				if (sessionResource) {
					delegate.removeAutoApprovedSession(sessionResource.toString());
				}
				break;
			}
			case 'get_session_info': {
				return await this._gatherSessionInfo();
			}
			case 'get_session_changes': {
				const sessionId = typeof toolCall.args?.coding_session_id === 'string'
					? toolCall.args.coding_session_id
					: undefined;
				return await this._gatherSessionChanges(sessionId);
			}
			case 'get_session_thread': {
				const sessionId = typeof toolCall.args?.coding_session_id === 'string'
					? toolCall.args.coding_session_id
					: undefined;
				const rawN = toolCall.args?.last_n_turns;
				const lastN = typeof rawN === 'number' && rawN > 0 ? Math.min(10, Math.floor(rawN)) : 3;
				return await this._gatherSessionThread(sessionId, lastN);
			}
		}
		return 'ok';
	}

	private _findSessionResource(sessionId: string): URI | undefined {
		if (!sessionId) {
			return undefined;
		}
		for (const model of this.chatService.chatModels.get()) {
			if (model.sessionResource.toString() === sessionId) {
				return model.sessionResource;
			}
		}

		const normalizedSessionId = sessionId.trim().toLocaleLowerCase();
		const labeledSessions: any[] = [];
		if (labeledSessions.length === 1) {
			return labeledSessions[0].resource;
		}

		const labeledChatModels = [...this.chatService.chatModels.get()].filter(model =>
			model.title?.trim().toLocaleLowerCase() === normalizedSessionId
		);
		return labeledChatModels.length === 1 ? labeledChatModels[0].sessionResource : undefined;
	}

	private async _showActionTarget(sessionId: string): Promise<{ ok: true; resource: URI } | { ok: false; reason: 'no_session' | 'session_not_found' | 'switch_failed' }> {
		const delegate = this._delegate;
		if (!delegate) {
			return { ok: false, reason: 'no_session' };
		}
		const resource = sessionId
			? this._findSessionResource(sessionId)
			: delegate.getTargetSessionResource() ?? await delegate.getCurrentSessionResource();
		if (!resource) {
			return { ok: false, reason: sessionId ? 'session_not_found' : 'no_session' };
		}
		const current = await delegate.getCurrentSessionResource();
		if (current?.toString() !== resource.toString() && !await delegate.switchToSession(resource)) {
			return { ok: false, reason: 'switch_failed' };
		}
		if (sessionId) {
			delegate.setTargetSession(resource);
		}
		return { ok: true, resource };
	}

	async respondToSession(toolCall: IVoiceToolCall): Promise<IVoiceDispatchResult> {
		const args = toolCall.args;
		const argString = (key: string): string => {
			const value = args[key];
			return typeof value === 'string' ? value : '';
		};
		const response = args['response'];
		if (!response || typeof response !== 'object' || Array.isArray(response)) {
			return { ok: false, reason: 'unsupported' };
		}
		const responseType = (response as Record<string, unknown>)['type'];
		if (responseType !== 'approve' && responseType !== 'reject' && responseType !== 'answer' && responseType !== 'skip') {
			return { ok: false, reason: 'unsupported' };
		}

		const resolved = await this._resolveModelForResponse(argString('coding_session_id'));
		if (!resolved) {
			return { ok: false, reason: 'no_session' };
		}
		try {
			return await this._applyResponse(
				resolved.model,
				argString('request_id'),
				argString('pending_id'),
				responseType,
				response as Record<string, unknown>,
			);
		} finally {
			resolved.dispose();
		}
	}

	private async _applyResponse(
		model: IChatModel,
		requestId: string,
		pendingId: string,
		responseType: 'approve' | 'reject' | 'answer' | 'skip',
		response: Record<string, unknown>,
	): Promise<IVoiceDispatchResult> {
		const request = model.getRequests().find(candidate => candidate.id === requestId);
		const parts = request?.response?.response.value;
		if (!request || !parts) {
			return { ok: false, reason: 'stale_pending' };
		}
		const index = parts.findIndex(candidate => peekPendingId(request.id, candidate) === pendingId);
		if (index < 0) {
			return { ok: false, reason: 'stale_pending' };
		}
		const part = parts[index];

		if (part.kind === 'questionCarousel') {
			if (responseType !== 'answer' && responseType !== 'skip') {
				return { ok: false, reason: 'unsupported' };
			}
			return this._answerCarousel(request.id, part as IChatQuestionCarousel, response, responseType === 'skip');
		}

		if (responseType === 'answer' || responseType === 'skip') {
			return { ok: false, reason: 'unsupported' };
		}
		const approve = responseType === 'approve';

		if (part.kind === 'planReview' && part instanceof ChatPlanReviewData) {
			return this._resolvePlanReview(part, approve) ? { ok: true } : { ok: false, reason: 'stale_pending' };
		}

		if (part.kind === 'toolInvocation') {
			if (getVoiceConfirmationType([part]) !== 'tool') {
				return { ok: false, reason: 'unsupported' };
			}
			markPendingIdResolved(pendingId);
			const confirmed = IChatToolInvocation.confirmWith(
				part as IChatToolInvocation,
				approve ? { type: ToolConfirmKind.UserAction } : { type: ToolConfirmKind.Denied },
			);
			return confirmed ? { ok: true } : { ok: false, reason: 'stale_pending' };
		}

		return { ok: false, reason: 'unsupported' };
	}

	private _resolvePlanReview(plan: ChatPlanReviewData, approve: boolean): boolean {
		if (plan.isUsed) {
			return false;
		}
		let result: IChatPlanReviewResult;
		if (approve) {
			const action = plan.actions.find(candidate => candidate.default) ?? plan.actions[0];
			if (!action) {
				return false;
			}
			result = {
				action: action.label,
				actionId: action.id,
				rejected: false,
			};
		} else {
			result = { rejected: true };
		}
		plan.data = result;
		plan.isUsed = true;
		void plan.completion.complete(result);
		return true;
	}

	private async _resolveModelForResponse(codingSessionId: string): Promise<{ model: IChatModel; dispose(): void } | undefined> {
		if (!codingSessionId) {
			return undefined;
		}
		for (const chatModel of this.chatService.chatModels.get()) {
			if (chatModel.sessionResource.toString() === codingSessionId) {
				return { model: chatModel, dispose: () => { } };
			}
		}
		return undefined;
	}

	private _answerCarousel(
		requestId: string,
		carousel: IChatQuestionCarousel,
		response: Record<string, unknown>,
		skip: boolean,
	): IVoiceDispatchResult {
		if (carousel.isUsed || carousel.answeredExternally) {
			return { ok: false, reason: 'stale_pending' };
		}
		if (skip && !carousel.allowSkip) {
			return { ok: false, reason: 'stale_pending' };
		}
		const raw = response['answers'];
		if (raw !== undefined && !Array.isArray(raw)) {
			return { ok: false, reason: 'invalid_answer' };
		}
		const rawAnswers = (raw ?? []) as IBackendQuestionAnswer[];
		let answers: IChatQuestionAnswers | undefined;
		if (rawAnswers.length > 0) {
			answers = resolveQuestionAnswers(carousel.questions, rawAnswers);
			if (!answers) {
				return { ok: false, reason: 'invalid_answer' };
			}
		} else if (!skip) {
			return { ok: false, reason: 'invalid_answer' };
		}
		if (!skip && carousel.questions.some(question => question.required && answers?.[question.id] === undefined)) {
			return { ok: false, reason: 'invalid_answer' };
		}
		if (!(carousel instanceof ChatQuestionCarouselData) && !carousel.resolveId) {
			return { ok: false, reason: 'unsupported' };
		}
		if (carousel instanceof ChatQuestionCarouselData) {
			carousel.dismiss(answers);
		} else {
			carousel.data = answers;
			carousel.isUsed = true;
		}
		if (carousel.resolveId) {
			this.chatService.notifyQuestionCarouselAnswer(requestId, carousel.resolveId, answers);
		}
		return { ok: true };
	}


	private async _gatherSessionInfo(): Promise<string> {
		const agentSessions: any[] = [];
		const currentResource = await this._delegate?.getCurrentSessionResource();
		const activeResource = this._delegate?.getTargetSessionResource() ?? currentResource;
		const agentResources = new Set(agentSessions.map((session: any) => session.resource.toString()));
		const inputDetails = (model: IChatModel | undefined) => {
			const state = model?.inputModel?.state?.get();
			const selected = state?.selectedModel;
			const attachments = state?.attachments.filter(isExplicitFileOrImageVariableEntry) ?? [];
			return {
				...(selected ? { selected_model: voiceModelReference(selected) } : {}),
				...(attachments.length ? {
					attachment_names: attachments.map(attachment => attachment.name).slice(0, 10),
					attachment_count: attachments.length,
				} : {}),
			};
		};
		const lastResponseSummary = (model: IChatModel | undefined): string | undefined => {
			const summary = model?.getRequests().at(-1)?.response?.response.value
				.filter(part => part.kind === 'markdownContent')
				.map(part => (part as { content: { value: string } }).content.value)
				.join(' ')
				.slice(0, 500);
			return summary || undefined;
		};

		const sessionData: Array<Record<string, unknown> & { state: string; is_active: boolean; last_activity: number }> = agentSessions.map((session: any) => {
			const model = this.chatService.getSession(session.resource);
			const changes = session.changes as any;
			const state = model
				? model.requestNeedsInput?.get() ? 'waiting_for_input' : model.hasActiveRequest?.get() ? 'working' : 'idle'
				: 'unknown';
			const lastActivity = session.timing.lastRequestEnded ?? session.timing.lastRequestStarted ?? session.timing.created ?? 0;
			return {
				id: session.resource.toString(),
				label: session.label || undefined,
				session_type: 'agent' as const,
				state,
				is_active: activeResource?.toString() === session.resource.toString(),
				insertions: changes?.insertions ?? 0,
				deletions: changes?.deletions ?? 0,
				last_activity: lastActivity,
				last_activity_minutes_ago: lastActivity ? Math.max(0, Math.round((Date.now() - lastActivity) / 60000)) : undefined,
				last_response_summary: lastResponseSummary(model),
				...inputDetails(model),
			};
		});

		for (const model of this.chatService.chatModels.get()) {
			const sessionId = model.sessionResource.toString();
			const isActive = activeResource?.toString() === sessionId;
			if (agentResources.has(sessionId) || (model.getRequests().length === 0 && !isActive)) {
				continue;
			}
			const needsInput = model.requestNeedsInput?.get();
			const inProgress = model.hasActiveRequest?.get();
			const lastActivity = model.lastMessageDate || 0;
			sessionData.push({
				id: sessionId,
				label: model.title || undefined,
				session_type: 'chat',
				state: needsInput ? 'waiting_for_input' : inProgress ? 'working' : 'idle',
				is_active: isActive,
				insertions: 0,
				deletions: 0,
				last_activity: lastActivity,
				last_activity_minutes_ago: lastActivity ? Math.max(0, Math.round((Date.now() - lastActivity) / 60000)) : undefined,
				last_response_summary: lastResponseSummary(model),
				...inputDetails(model),
			});
		}

		sessionData.sort((a, b) => Number(b.is_active) - Number(a.is_active) || b.last_activity - a.last_activity);
		const counts = sessionData.reduce((result, session) => {
			if (session.state === 'working') { result.working++; }
			else if (session.state === 'waiting_for_input') { result.waiting_for_input++; }
			else if (session.state === 'idle') { result.idle++; }
			return result;
		}, { working: 0, waiting_for_input: 0, idle: 0 });
		const visibleSessions = sessionData.slice(0, 20).map(({ last_activity, ...session }) => session);
		return JSON.stringify({
			total_sessions: sessionData.length,
			counts,
			sessions: visibleSessions,
			truncated: visibleSessions.length < sessionData.length,
		});
	}

	private async _resolveSession(coding_session_id: string | undefined) {
		const sessions: any[] = [];
		if (coding_session_id) {
			const match = sessions.find((s: any) => s.resource.toString() === coding_session_id);
			if (match) {
				return match;
			}
		}
		const currentResource = await this._delegate?.getCurrentSessionResource();
		if (currentResource) {
			const active = sessions.find((s: any) => s.resource.toString() === currentResource.toString());
			if (active) {
				return active;
			}
		}
		return sessions[0];
	}

	private async _gatherSessionChanges(coding_session_id: string | undefined): Promise<string> {
		const session = await this._resolveSession(coding_session_id);
		if (!session) {
			return JSON.stringify({ session_id: coding_session_id ?? null, files: [], note: 'session_not_found' });
		}

		const changes = session.changes;
		const files: { path: string; insertions: number; deletions: number }[] = [];
		let totalInsertions = 0;
		let totalDeletions = 0;
		let totalFiles = 0;

		if (Array.isArray(changes)) {
			for (const c of changes) {
				const uri = (c as { modifiedUri?: URI }).modifiedUri ?? (c as { uri?: URI }).uri;
				const path = uri ? this._formatPath(uri) : '(unknown)';
				files.push({ path, insertions: c.insertions, deletions: c.deletions });
				totalInsertions += c.insertions;
				totalDeletions += c.deletions;
			}
			totalFiles = files.length;
		} else if (changes && !Array.isArray(changes)) {
			const summary = changes as { files: number; insertions: number; deletions: number };
			totalInsertions = summary.insertions;
			totalDeletions = summary.deletions;
			totalFiles = summary.files;
		}

		return JSON.stringify({
			session_id: session.resource.toString(),
			total_files: totalFiles,
			total_insertions: totalInsertions,
			total_deletions: totalDeletions,
			files: files.slice(0, 20),
			truncated: files.length > 20,
		});
	}

	private async _gatherSessionThread(coding_session_id: string | undefined, lastN: number): Promise<string> {
		const session = await this._resolveSession(coding_session_id);
		if (!session) {
			return JSON.stringify({ session_id: coding_session_id ?? null, turns: [], note: 'session_not_found' });
		}

		const model = this.chatService.getSession(session.resource);
		if (!model) {
			return JSON.stringify({
				session_id: session.resource.toString(),
				turns: [],
				note: 'chat_model_not_loaded',
			});
		}

		const reqs = model.getRequests().slice(-lastN);
		const turns = reqs.map(req => {
			const userText = req.message.text || '';
			const assistantText = req.response?.response.value
				.filter(p => p.kind === 'markdownContent')
				.map(p => (p as { content: { value: string } }).content.value)
				.join(' ')
				.slice(0, 600) || '';
			return {
				user: userText.slice(0, 400),
				assistant: assistantText,
			};
		});

		return JSON.stringify({
			session_id: session.resource.toString(),
			turn_count: turns.length,
			turns,
		});
	}

	private _formatPath(uri: URI): string {
		const parts = uri.path.split('/').filter(Boolean);
		if (parts.length <= 2) {
			return uri.path.replace(/^\//, '');
		}
		return parts.slice(-2).join('/');
	}
}

registerSingleton(IVoiceToolDispatchService, VoiceToolDispatchService, InstantiationType.Delayed);

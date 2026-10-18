/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ChatRequest } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { AutoChatEndpoint } from './autoChatEndpoint';
import { ILogService } from '../../log/common/logService';
import { IChatEndpoint } from '../../networking/common/networking';
import { RouterDecisionFetcher } from './routerDecisionFetcher';

export interface AutoModeRoutingDecision {
	resolvedModel: string;
	resolvedModelName: string;
	predictedLabel: 'needs_reasoning' | 'no_reasoning' | 'fallback';
	confidence: number;
}

export const IAutomodeService = createServiceIdentifier<IAutomodeService>('IAutomodeService');

export interface IAutomodeService {
	readonly _serviceBrand: undefined;
	resolveAutoModeEndpoint(chatRequest: ChatRequest | undefined, knownEndpoints: IChatEndpoint[]): Promise<IChatEndpoint>;
	consumeLastRoutingDecision(): AutoModeRoutingDecision | undefined;
	invalidateRouterCache(chatRequest: ChatRequest): void;
}

interface CachedAutoEndpoint {
	endpoint: IChatEndpoint;
	needsReEval: boolean;
}

export class AutomodeService extends Disposable implements IAutomodeService {
	declare readonly _serviceBrand: undefined;
	private readonly _autoModelCache = new Map<string, CachedAutoEndpoint>();
	private readonly _routerDecisionFetcher: RouterDecisionFetcher;
	private _lastRoutingDecision: AutoModeRoutingDecision | undefined;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._routerDecisionFetcher = new RouterDecisionFetcher(this._logService);
	}

	consumeLastRoutingDecision(): AutoModeRoutingDecision | undefined {
		const decision = this._lastRoutingDecision;
		this._lastRoutingDecision = undefined;
		return decision;
	}

	invalidateRouterCache(chatRequest: ChatRequest): void {
		const conversationId = this._conversationId(chatRequest);
		if (!conversationId) {
			return;
		}
		const cached = this._autoModelCache.get(conversationId);
		if (cached) {
			cached.needsReEval = true;
			this._logService.trace(`[AutomodeService] Local Router decision invalidated for conversation ${conversationId}`);
		}
	}

	async resolveAutoModeEndpoint(chatRequest: ChatRequest | undefined, knownEndpoints: IChatEndpoint[]): Promise<IChatEndpoint> {
		const endpoints = knownEndpoints.filter(endpoint =>
			!(endpoint instanceof AutoChatEndpoint) && endpoint.model.toLowerCase() !== AutoChatEndpoint.pseudoModelId
		);
		if (!endpoints.length) {
			throw new Error('Dardcor Router has no available chat models for Auto mode.');
		}

		this._lastRoutingDecision = undefined;
		const imageRequested = hasImage(chatRequest);
		const visionEndpoints = imageRequested ? endpoints.filter(endpoint => endpoint.supportsVision) : endpoints;
		const candidates = visionEndpoints.length ? visionEndpoints : endpoints;
		if (imageRequested && !visionEndpoints.length) {
			this._logService.warn('[AutomodeService] No vision-capable Router model is available for this request.');
		}

		const conversationId = chatRequest ? this._conversationId(chatRequest) : undefined;
		const cached = conversationId ? this._autoModelCache.get(conversationId) : undefined;
		const cachedModel = cached && !cached.needsReEval
			? candidates.find(endpoint => endpoint.model === cached.endpoint.model)
			: undefined;
		const prompt = chatRequest?.prompt?.trim();
		let selected = cachedModel;
		let predictedLabel: AutoModeRoutingDecision['predictedLabel'] = 'fallback';
		let confidence = 0;

		if (!selected) {
			selected = this._selectDeterministicFallback(candidates, prompt ?? '');
			if (prompt && candidates.length > 1) {
				try {
					const classifier = this._selectClassifierModel(candidates, selected);
					const decision = await this._routerDecisionFetcher.getRouterDecision(
						prompt,
						classifier.model,
						candidates.map(endpoint => ({
							id: endpoint.model,
							name: endpoint.name,
							supportsReasoning: this._supportsReasoning(endpoint),
							supportsVision: endpoint.supportsVision,
							supportsTools: endpoint.supportsToolCalls,
							contextTokens: endpoint.modelMaxPromptTokens,
						})),
						imageRequested,
					);
					const routedEndpoint = candidates.find(endpoint => endpoint.model === decision.model);
					if (routedEndpoint) {
						selected = routedEndpoint;
						predictedLabel = decision.predictedLabel;
						confidence = decision.confidence;
					} else {
						this._logService.warn(`[AutomodeService] Router classifier returned an unknown model '${decision.model}'; using '${selected.model}'.`);
					}
				} catch (error) {
					this._logService.warn(`[AutomodeService] Router classifier failed; using '${selected.model}'. ${error instanceof Error ? error.message : String(error)}`);
				}
			}
		}

		const autoEndpoint = this._instantiationService.createInstance(AutoChatEndpoint, selected, 0, { low: 0, high: 0 });
		if (conversationId) {
			this._autoModelCache.set(conversationId, { endpoint: autoEndpoint, needsReEval: false });
		}
		this._lastRoutingDecision = {
			resolvedModel: selected.model,
			resolvedModelName: selected.name,
			predictedLabel: cachedModel ? 'fallback' : predictedLabel,
			confidence: cachedModel ? 1 : confidence,
		};
		this._logService.trace(`[AutomodeService] Selected '${selected.model}'${cachedModel ? ' from conversation cache' : ''}.`);
		return autoEndpoint;
	}

	private _selectClassifierModel(endpoints: IChatEndpoint[], fallback: IChatEndpoint): IChatEndpoint {
		return endpoints.find(endpoint => /(?:mini|flash|haiku|small|fast|lite)/i.test(`${endpoint.model} ${endpoint.name}`)) ?? fallback;
	}

	private _selectDeterministicFallback(endpoints: IChatEndpoint[], prompt: string): IChatEndpoint {
		const complexitySignal = /\b(architect|architecture|refactor|debug|debugging|security|migrate|migration|analy[sz]e|reason|complex|multi[- ]step|root cause)\b/i.test(prompt);
		const preferred = complexitySignal
			? endpoints.find(endpoint => this._supportsReasoning(endpoint))
			: this._selectClassifierModel(endpoints, endpoints[0]);
		return endpoints.find(endpoint => endpoint.isFallback) ?? preferred ?? endpoints[0];
	}

	private _supportsReasoning(endpoint: IChatEndpoint): boolean {
		return !!endpoint.supportsReasoningEffort?.length || /(?:reason|thinking|o1|o3|r1|opus|pro)/i.test(`${endpoint.model} ${endpoint.name}`);
	}

	private _conversationId(chatRequest: ChatRequest): string | undefined {
		return chatRequest.sessionResource?.toString() ?? chatRequest.sessionId ?? undefined;
	}
}

function hasImage(chatRequest: ChatRequest | undefined): boolean {
	return !!chatRequest?.references?.some(reference => {
		const value = reference.value;
		return typeof value === 'object' && value !== null && 'mimeType' in value &&
			typeof value.mimeType === 'string' && value.mimeType.startsWith('image/');
	});
}

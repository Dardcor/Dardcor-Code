/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../log/common/log.js';
import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { IDardcorRouterService, type IDardcorUtilityChatMessage } from './dardcorRouterService.js';

export const AGENT_BRANCH_PREFIX = 'agents/';
const AGENT_BRANCH_SESSION_ID_SUFFIX_LENGTH = 8;
const MAX_BRANCH_NAME_HINT_LENGTH = 48;
const MIN_GENERATED_BRANCH_NAME_LENGTH = 8;
const MAX_BRANCH_NAME_CANDIDATES = 100;

export interface IAgentBranchNameGeneratorRequest {
	readonly sessionId: string;
	readonly message?: string;
	readonly signal?: AbortSignal;
	readonly branchPrefix?: string;
	readonly branchNameCollides?: (branchName: string) => Promise<boolean>;
}

export const IAgentBranchNameGenerator = createDecorator<IAgentBranchNameGenerator>('agentBranchNameGenerator');

export interface IAgentBranchNameGenerator {
	readonly _serviceBrand: undefined;
	generateBranchName(request: IAgentBranchNameGeneratorRequest): Promise<string>;
}

export class AgentBranchNameGenerator implements IAgentBranchNameGenerator {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IDardcorRouterService private readonly _dardcorRouterService: IDardcorRouterService,
		@ILogService private readonly _logService: ILogService,
	) { }

	async generateBranchName(request: IAgentBranchNameGeneratorRequest): Promise<string> {
		const branchNameHint = (await this._generateBranchNameHint(request)) ?? getAgentBranchNameHintFromMessage(request.message ?? '');
		return this._buildBranchName(request, branchNameHint);
	}

	private async _generateBranchNameHint(request: IAgentBranchNameGeneratorRequest): Promise<string | undefined> {
		const message = request.message?.trim();
		if (!message) {
			return undefined;
		}

		try {
			const rawBranchName = await this._dardcorRouterService.utilityChatCompletion({
				messages: this._buildBranchNamePrompt(message),
			}, {
				signal: request.signal,
			});

			if (request.signal?.aborted) {
				return undefined;
			}

			let branchName = rawBranchName.trim();
			if (branchName.match(/^".*"$/)) {
				branchName = branchName.slice(1, -1);
			}
			if (branchName.includes('can\'t assist with that')) {
				return undefined;
			}

			branchName = normalizeAgentBranchName(branchName).slice(0, MAX_BRANCH_NAME_HINT_LENGTH).replace(/-+$/g, '');
			if (branchName.length < MIN_GENERATED_BRANCH_NAME_LENGTH) {
				this._logService.warn('Generated branch name is too short after normalization, discarding.');
				return undefined;
			}

			return branchName;
		} catch (err) {
			this._logService.warn('[AgentBranchNameGenerator] Failed to generate branch name', err);
			return undefined;
		}
	}

	private _buildBranchNamePrompt(userRequest: string): IDardcorUtilityChatMessage[] {
		return [
			{
				role: 'system',
				content: [
					'You are an expert in crafting pithy branch names for Git Repos based on chatbot conversations.',
					'You are presented with a chat request, and you reply with a brief branch name that captures the main topic of that request.',
					'The branch name should not be wrapped in quotes. It should be between 8-50 characters.',
					'Here are some examples of good branch names:',
					'- linkedlist-implementation',
					'- adding-tree-view',
					'- react-usestate-hook-usage',
				].join(' '),
			},
			{
				role: 'user',
				content: `Please write a brief branch name for the following request:\n\n${userRequest}`,
			},
		];
	}

	private async _buildBranchName(request: IAgentBranchNameGeneratorRequest, branchNameHint: string | undefined): Promise<string> {
		const prefix = `${request.branchPrefix ?? ''}${AGENT_BRANCH_PREFIX}`;

		const branchName = `${prefix}${branchNameHint ?? request.sessionId}`;
		const collisionBase = branchNameHint
			? `${branchName}-${request.sessionId.substring(0, AGENT_BRANCH_SESSION_ID_SUFFIX_LENGTH)}`
			: branchName;
		for (let candidateIndex = 0; candidateIndex < MAX_BRANCH_NAME_CANDIDATES; candidateIndex++) {
			const candidate = candidateIndex === 0
				? branchName
				: branchNameHint && candidateIndex === 1
					? collisionBase
					: `${collisionBase}-${branchNameHint ? candidateIndex : candidateIndex + 1}`;
			if (!request.branchNameCollides || !await request.branchNameCollides(candidate)) {
				return candidate;
			}
		}

		throw new Error(`Unable to find an available branch name after checking ${MAX_BRANCH_NAME_CANDIDATES} candidates`);
	}
}

export function normalizeAgentBranchName(branchName: string): string {
	let normalized = branchName.replace(/[^a-zA-Z0-9\-]/g, '').toLowerCase();
	normalized = normalized.replace(/\.{2,}/g, '.');
	normalized = normalized.replace(/^[-.]+/, '');
	normalized = normalized.replace(/[./]+$/, '');
	normalized = normalized.replace(/\.lock$/, '');

	return normalized;
}

export function getAgentBranchNameHintFromMessage(message: string): string | undefined {
	const words = message
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.split('-')
		.filter(word => word.length > 0)
		.slice(0, 8);
	const hint = words.join('-').slice(0, MAX_BRANCH_NAME_HINT_LENGTH).replace(/-+$/g, '');
	return hint.length > 0 ? hint : undefined;
}

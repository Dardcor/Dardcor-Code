/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { LRUCache } from '../../../../base/common/map.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ChatMessageRole, ILanguageModelsService } from '../common/languageModels.js';

export const IChatGoalSummaryService = createDecorator<IChatGoalSummaryService>('chatGoalSummaryService');

export interface IChatGoalSummaryService {
	readonly _serviceBrand: undefined;

	summarize(prompt: string, token: CancellationToken): Promise<string | undefined>;
}

const MAX_PROMPT_CHARS = 4000;
const MAX_SUMMARY_CHARS = 100;
const CACHE_SIZE = 50;

const REFUSAL_PREFIX_RE = /^(?:sorry\b|unfortunately\b|my apologies\b|as an ai\b|i\s+apologi[sz]e\b|i\s*['\u2019]?m\s+sorry\b|i\s+am\s+sorry\b|i\s*['\u2019]?m\s+unable\b|i\s+am\s+unable\b|i\s+am\s+not\s+able\b|i\s*(?:can['\u2019]?t|cannot|can\s?not|won['\u2019]?t)\b)/i;

export class ChatGoalSummaryService implements IChatGoalSummaryService {
	declare readonly _serviceBrand: undefined;

	private readonly _cache = new LRUCache<string, string>(CACHE_SIZE);
	private readonly _inFlight = new Map<string, Promise<string | undefined>>();

	constructor(
		@ILanguageModelsService private readonly _languageModelsService: ILanguageModelsService,
	) { }

	async summarize(prompt: string, token: CancellationToken): Promise<string | undefined> {
		const key = prompt.trim();
		if (!key) {
			return undefined;
		}

		const cached = this._cache.get(key);
		if (cached) {
			return cached;
		}

		const inflight = this._inFlight.get(key);
		if (inflight) {
			return inflight;
		}

		const promise = (async () => {
			try {
				const summary = await this._invokeModel(key, token);
				if (summary && !token.isCancellationRequested) {
					this._cache.set(key, summary);
				}
				return summary;
			} catch {
				return undefined;
			} finally {
				this._inFlight.delete(key);
			}
		})();

		this._inFlight.set(key, promise);
		return promise;
	}

	private async _invokeModel(prompt: string, token: CancellationToken): Promise<string | undefined> {
		const models = await this._languageModelsService.selectLanguageModels({ vendor: 'dardcor', id: 'dardcor-utility-small' });
		if (!models.length || token.isCancellationRequested) {
			return undefined;
		}

		const truncatedPrompt = prompt.length > MAX_PROMPT_CHARS ? prompt.slice(0, MAX_PROMPT_CHARS) + '...[truncated]' : prompt;
		const systemPrompt = [
			'You summarize a user\'s coding request into a single short phrase suitable for a status badge.',
			'Reply with the phrase only — no prose, no quotes, no leading "Goal:", no punctuation at the end.',
			'Use the imperative ("Add tests for X", "Fix the avatar popup bug").',
			'Keep it under 80 characters. Prefer the user\'s own nouns and verbs.',
			'This is a benign labeling task: never refuse or apologize. Always restate the request as a phrase, even if it seems unusual.',
		].join(' ');

		const response = await this._languageModelsService.sendChatRequest(
			models[0],
			undefined,
			[
				{ role: ChatMessageRole.System, content: [{ type: 'text', value: systemPrompt }] },
				{ role: ChatMessageRole.User, content: [{ type: 'text', value: truncatedPrompt }] },
			],
			{},
			token,
		);

		let text = '';
		for await (const part of response.stream) {
			if (token.isCancellationRequested) {
				return undefined;
			}
			if (Array.isArray(part)) {
				for (const p of part) {
					if (p.type === 'text') {
						text += p.value;
					}
				}
			} else if (part.type === 'text') {
				text += part.value;
			}
		}
		await response.result;
		if (token.isCancellationRequested) {
			return undefined;
		}

		return cleanGoalSummary(text);
	}
}

export function cleanGoalSummary(raw: string): string | undefined {
	let s = raw.trim();
	if (!s) {
		return undefined;
	}
	s = s.replace(/^["'`]+|["'`]+$/g, '');
	s = s.replace(/^\s*goal\s*[:\-—]\s*/i, '');
	s = s.replace(/\s+/g, ' ').trim();
	if (!s || REFUSAL_PREFIX_RE.test(s)) {
		return undefined;
	}
	if (s.length > MAX_SUMMARY_CHARS) {
		s = s.slice(0, MAX_SUMMARY_CHARS - 1).replace(/\s+\S*$/, '') + '…';
	}
	return s || undefined;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const OmniChatEnabledSettingId = 'chat.omni.enabled';

export const SESSION_ROUTE_CONFIDENCE_THRESHOLD = 0.8;

export function isHighConfidenceSessionRoute(result: ISessionRouteResult): boolean {
	return result.confidence > SESSION_ROUTE_CONFIDENCE_THRESHOLD;
}

export interface IRoutableSession {
	readonly sessionId: string;
	readonly label: string;
	readonly repo?: string;
	readonly cwd?: string;
	readonly status?: string;
	readonly lastActivity?: number;
	readonly description?: string;
	readonly firstRequest?: string;
	readonly lastRequest?: string;
	readonly lastResponse?: string;
}

export interface ISessionRouteResult {
	readonly sessionId: string;
	readonly confidence: number;
	readonly reason?: string;
}

export interface ISessionRouteRequest {
	readonly utterance: string;
	readonly sessions: readonly IRoutableSession[];
}

export const ISessionRouter = createDecorator<ISessionRouter>('sessionRouter');

export interface ISessionRouter {
	readonly _serviceBrand: undefined;

	route(request: ISessionRouteRequest, token: CancellationToken): Promise<ISessionRouteResult[]>;
}


export interface ISessionRouterMessage {
	readonly role: 'system' | 'user';
	readonly content: string;
}

export const ROUTER_FIELD_CLIP_LENGTH = 240;

function clip(text: string, max: number = ROUTER_FIELD_CLIP_LENGTH): string {
	const normalized = text.replace(/\s+/g, ' ').trim();
	return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}






export function buildRouterMessages(request: ISessionRouteRequest): ISessionRouterMessage[] {
	const sessionLines = request.sessions.map(session => {
		const parts = [`id=${session.sessionId}`, `name=${JSON.stringify(session.label)}`];
		if (session.repo) { parts.push(`repo=${session.repo}`); }
		if (session.cwd) { parts.push(`cwd=${session.cwd}`); }
		if (session.status) { parts.push(`status=${session.status}`); }
		if (session.description) { parts.push(`summary=${JSON.stringify(clip(session.description))}`); }
		if (session.firstRequest) { parts.push(`firstRequest=${JSON.stringify(clip(session.firstRequest))}`); }
		if (session.lastRequest) { parts.push(`lastRequest=${JSON.stringify(clip(session.lastRequest))}`); }
		if (session.lastResponse) { parts.push(`lastResponse=${JSON.stringify(clip(session.lastResponse))}`); }
		return `- ${parts.join(' ')}`;
	}).join('\n');

	const system = [
		'Decide from the user request whether it is best handled as a continuation of an existing coding session or whether it warrants a new session.',
		'Route to an existing session only when continuing that session preserves useful task context; prefer a new session for a distinct task, even when it is in the same repository.',
		'Each candidate may include a summary plus its first request, most recent request, and most recent response; weigh these more heavily than the name when present.',
		'Score every candidate session from 0 (no match) to 1 (certain match).',
		'Reserve scores above 0.8 for a clear continuation of the same concrete task; shared repository names or generic coding terms are not enough.',
		'When the request could reasonably start a new task, score every existing session at 0.8 or below.',
		'Respond with ONLY a JSON array, sorted by confidence descending, of objects:',
		'[{"sessionId": string, "confidence": number, "reason": string}]',
		'Do not include any prose or code fences.'
	].join('\n');

	const user = `Request: ${JSON.stringify(request.utterance)}\nSessions:\n${sessionLines}`;

	return [
		{ role: 'system', content: system },
		{ role: 'user', content: user }
	];
}

export function parseRouterResponse(text: string, validSessionIds: ReadonlySet<string>): ISessionRouteResult[] | undefined {
	const match = text.match(/\[[\s\S]*\]/);
	if (!match) {
		return undefined;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(match[0]);
	} catch {
		return undefined;
	}
	if (!Array.isArray(parsed)) {
		return undefined;
	}

	const results: ISessionRouteResult[] = [];
	const seen = new Set<string>();
	for (const entry of parsed) {
		if (!entry || typeof entry !== 'object') {
			continue;
		}
		const record = entry as Record<string, unknown>;
		const sessionId = record.sessionId;
		if (typeof sessionId !== 'string' || !validSessionIds.has(sessionId) || seen.has(sessionId)) {
			continue;
		}
		const rawConfidence = record.confidence;
		if (typeof rawConfidence !== 'number' || !isFinite(rawConfidence)) {
			continue;
		}
		const confidence = Math.max(0, Math.min(1, rawConfidence));
		seen.add(sessionId);
		results.push({
			sessionId,
			confidence,
			reason: typeof record.reason === 'string' ? record.reason : undefined
		});
	}

	if (!results.length) {
		return undefined;
	}
	results.sort((a, b) => b.confidence - a.confidence);
	return results;
}

export function heuristicScore(request: ISessionRouteRequest): ISessionRouteResult[] {
	const terms = new Set(tokenize(request.utterance));
	const results = request.sessions.map(session => {
		if (!terms.size) {
			return { sessionId: session.sessionId, confidence: 0 };
		}
		const fields = [session.label, session.repo, session.cwd, session.description, session.firstRequest, session.lastRequest, session.lastResponse].filter(isNonEmpty);
		let bestRecall = 0;
		const matchedTerms = new Set<string>();
		for (const field of fields) {
			const fieldTokens = new Set(tokenize(field));
			if (!fieldTokens.size) {
				continue;
			}
			let fieldHits = 0;
			for (const token of fieldTokens) {
				if (terms.has(token)) {
					fieldHits++;
					matchedTerms.add(token);
				}
			}
			bestRecall = Math.max(bestRecall, fieldHits / fieldTokens.size);
		}
		if (!matchedTerms.size) {
			return { sessionId: session.sessionId, confidence: 0 };
		}
		const precision = matchedTerms.size / terms.size;
		const confidence = 0.75 * bestRecall + 0.25 * precision;
		return { sessionId: session.sessionId, confidence };
	});
	results.sort((a, b) => b.confidence - a.confidence);
	return results;
}

function tokenize(text: string): string[] {
	return text.toLowerCase().split(/[^a-z0-9]+/).filter(term => term.length > 1 && !ROUTER_STOP_WORDS.has(term));
}

function isNonEmpty(value: string | undefined): value is string {
	return !!value;
}

const ROUTER_STOP_WORDS = new Set([
	'about', 'agent', 'and', 'are', 'can', 'change', 'chat', 'code', 'fix', 'for', 'from', 'have', 'into', 'its', 'make',
	'on', 'please', 'project', 'repo', 'repository', 'session', 'task', 'that', 'the', 'this', 'to', 'update', 'was', 'with', 'work',
]);

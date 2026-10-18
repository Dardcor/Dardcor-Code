/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Mutable } from '../../../../base/common/types.js';
import type { Annotation, AnnotationEntry } from '../state/protocol/state.js';


export const FEEDBACK_ANNOTATION_META_KEY = 'vscode.agentFeedback';

export const VIEW_UNREVIEWED_COMMENTS_TOOL_NAME = 'viewUnreviewedComments';

export const ADD_COMMENT_TOOL_NAME = 'addComment';

export function isViewUnreviewedCommentsTool(toolName: string): boolean {
	return toolName === VIEW_UNREVIEWED_COMMENTS_TOOL_NAME || toolName.endsWith(`__${VIEW_UNREVIEWED_COMMENTS_TOOL_NAME}`);
}

export function isAddCommentTool(toolName: string): boolean {
	return toolName === ADD_COMMENT_TOOL_NAME || toolName.endsWith(`__${ADD_COMMENT_TOOL_NAME}`);
}

export type AgentFeedbackKindValue = 'user' | 'codeReview' | 'prReview';

export type AgentFeedbackStateValue = 'created' | 'accepted' | 'submitted' | 'resolved';

export interface IFeedbackPullRequest {
	readonly owner: string;
	readonly repo: string;
	readonly number: number;
}

export interface IFeedbackAnnotationMeta {
	readonly kind: AgentFeedbackKindValue;
	readonly state: AgentFeedbackStateValue;
	readonly sessionResource: string;
	readonly suggestion?: unknown;
	readonly codeSelection?: string;
	readonly diffHunks?: string;
	readonly sourcePRReviewCommentId?: string;
	readonly sourcePullRequest?: IFeedbackPullRequest;
	readonly pendingAgentReveal?: boolean;
}

function isAgentFeedbackKindValue(value: unknown): value is AgentFeedbackKindValue {
	return value === 'user' || value === 'codeReview' || value === 'prReview';
}

function isAgentFeedbackStateValue(value: unknown): value is AgentFeedbackStateValue {
	return value === 'created' || value === 'accepted' || value === 'submitted' || value === 'resolved';
}

function isFeedbackPullRequest(value: unknown): value is IFeedbackPullRequest {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}
	const candidate = value as Partial<IFeedbackPullRequest>;
	return typeof candidate.owner === 'string' && typeof candidate.repo === 'string' && typeof candidate.number === 'number';
}

export type AgentFeedbackAuthorValue = 'user' | 'agent' | 'prReviewer' | 'unknown';

export interface IFeedbackAnnotationEntryMeta {
	readonly author: AgentFeedbackAuthorValue;
}

function isAgentFeedbackAuthorValue(value: unknown): value is AgentFeedbackAuthorValue {
	return value === 'user' || value === 'agent' || value === 'prReviewer' || value === 'unknown';
}

export function authorForFeedbackKind(kind: AgentFeedbackKindValue | undefined): AgentFeedbackAuthorValue {
	switch (kind) {
		case 'user': return 'user';
		case 'codeReview': return 'agent';
		case 'prReview': return 'prReviewer';
		default: return 'unknown';
	}
}

export function feedbackAnnotationEntryMeta(author: AgentFeedbackAuthorValue): Record<string, unknown> {
	return { [FEEDBACK_ANNOTATION_META_KEY]: { author } satisfies IFeedbackAnnotationEntryMeta };
}

export function readFeedbackAnnotationEntryAuthor(entry: AnnotationEntry): AgentFeedbackAuthorValue | undefined {
	const meta = entry._meta;
	const slot = meta?.[FEEDBACK_ANNOTATION_META_KEY];
	if (!slot || typeof slot !== 'object' || Array.isArray(slot)) {
		return undefined;
	}
	const author = (slot as Record<string, unknown>)['author'];
	return isAgentFeedbackAuthorValue(author) ? author : undefined;
}

export function resolveFeedbackEntryAuthor(entry: AnnotationEntry, index: number, kind: AgentFeedbackKindValue | undefined): AgentFeedbackAuthorValue {
	return readFeedbackAnnotationEntryAuthor(entry) ?? (index === 0 ? authorForFeedbackKind(kind) : 'user');
}

export function readFeedbackAnnotationMeta(annotation: Annotation): IFeedbackAnnotationMeta | undefined {
	const meta = annotation._meta;
	const slot = meta?.[FEEDBACK_ANNOTATION_META_KEY];
	if (!slot || typeof slot !== 'object' || Array.isArray(slot)) {
		return undefined;
	}
	const raw = slot as Record<string, unknown>;
	if (!isAgentFeedbackKindValue(raw['kind']) || !isAgentFeedbackStateValue(raw['state']) || typeof raw['sessionResource'] !== 'string') {
		return undefined;
	}
	const result: Mutable<IFeedbackAnnotationMeta> = { kind: raw['kind'], state: raw['state'], sessionResource: raw['sessionResource'] };
	if (raw['suggestion'] !== undefined) { result.suggestion = raw['suggestion']; }
	if (typeof raw['codeSelection'] === 'string') { result.codeSelection = raw['codeSelection']; }
	if (typeof raw['diffHunks'] === 'string') { result.diffHunks = raw['diffHunks']; }
	if (typeof raw['sourcePRReviewCommentId'] === 'string') { result.sourcePRReviewCommentId = raw['sourcePRReviewCommentId']; }
	if (isFeedbackPullRequest(raw['sourcePullRequest'])) { result.sourcePullRequest = raw['sourcePullRequest']; }
	if (typeof raw['pendingAgentReveal'] === 'boolean') { result.pendingAgentReveal = raw['pendingAgentReveal']; }
	return result;
}

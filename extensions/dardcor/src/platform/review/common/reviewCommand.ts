/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { ReviewComment, ReviewSuggestion } from './reviewService';

export interface CodeReviewFileInput {
	readonly currentUri: vscode.Uri;
	readonly baseUri?: vscode.Uri;
}

export interface CodeReviewInput {
	readonly files: readonly CodeReviewFileInput[];
}

export interface CodeReviewSuggestionChange {
	readonly range: vscode.Range;
	readonly newText: string;
	readonly oldText: string;
}

export interface CodeReviewSuggestion {
	readonly edits: readonly CodeReviewSuggestionChange[];
}

export interface CodeReviewComment {
	readonly uri: vscode.Uri;
	readonly range: vscode.Range;
	readonly body: string;
	readonly kind: string;
	readonly severity: string;
	readonly suggestion?: CodeReviewSuggestion;
}

export type CodeReviewResult =
	| { readonly type: 'success'; readonly comments: readonly CodeReviewComment[] }
	| { readonly type: 'error'; readonly reason: string }
	| { readonly type: 'cancelled' };

function mapSuggestion(suggestion: ReviewSuggestion): CodeReviewSuggestion {
	return {
		edits: suggestion.edits.map(edit => ({
			range: edit.range,
			newText: edit.newText,
			oldText: edit.oldText,
		})),
	};
}

async function resolveSuggestion(suggestion: ReviewSuggestion | Promise<ReviewSuggestion> | undefined): Promise<ReviewSuggestion | undefined> {
	if (!suggestion) {
		return undefined;
	}
	return await suggestion;
}

export async function toCodeReviewResult(comments: readonly ReviewComment[]): Promise<CodeReviewResult> {
	return {
		type: 'success',
		comments: await Promise.all(comments.map(async comment => {
			const body = typeof comment.body === 'string' ? comment.body : comment.body.value;
			const suggestion = await resolveSuggestion(comment.suggestion);
			const result: CodeReviewComment = {
				uri: comment.uri,
				range: comment.range,
				body,
				kind: comment.kind,
				severity: comment.severity,
				...(suggestion?.edits.length ? { suggestion: mapSuggestion(suggestion) } : {}),
			};
			return result;
		})),
	};
}

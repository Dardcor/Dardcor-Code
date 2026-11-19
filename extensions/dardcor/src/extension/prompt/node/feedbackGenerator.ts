/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

import { TelemetryEventMeasurements, TelemetryEventProperties } from '@vscode/extension-telemetry';
import { RenderPromptResult } from '@vscode/prompt-tsx';
import type { CancellationToken, Progress } from 'vscode';
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { EditSurvivalReporter, EditSurvivalResult } from '../../../platform/editSurvivalTracking/common/editSurvivalReporter';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { IIgnoreService } from '../../../platform/ignore/common/ignoreService';
import { ILogService } from '../../../platform/log/common/logService';
import { ReviewComment, ReviewRequest } from '../../../platform/review/common/reviewService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { isNotebookCellOrNotebookChatInput } from '../../../util/common/notebooks';
import { coalesce } from '../../../util/dardcor/base/common/arrays';
import * as path from '../../../util/dardcor/base/common/path';
import { generateUuid } from '../../../util/dardcor/base/common/uuid';
import { StringEdit } from '../../../util/dardcor/editor/common/core/edits/stringEdit';
import { OffsetRange } from '../../../util/dardcor/editor/common/core/ranges/offsetRange';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { MarkdownString, Range } from '../../../dardcorTypes';
import { PromptRenderer } from '../../prompts/node/base/promptRenderer';
import { CurrentChangeInput } from '../../prompts/node/feedback/currentChange';
import { ProvideFeedbackPrompt } from '../../prompts/node/feedback/provideFeedback';
import { sendUserActionTelemetry } from './telemetry';

export type FeedbackResult = { type: 'success'; comments: ReviewComment[]; excludedComments?: ReviewComment[]; reason?: string } | { type: 'error'; severity?: 'info'; reason: string } | { type: 'cancelled' };

export class FeedbackGenerator {
	constructor(
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IEndpointProvider private readonly endpointProvider: IEndpointProvider,
		@ILogService private readonly logService: ILogService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IIgnoreService private readonly ignoreService: IIgnoreService,
	) { }

	async generateComments(input: CurrentChangeInput[], token: CancellationToken, progress?: Progress<ReviewComment[]>): Promise<FeedbackResult> {
		const startTime = Date.now();
		if (token.isCancellationRequested) {
			return { type: 'cancelled' };
		}
		if (input.length === 0) {
			return { type: 'success', comments: [], reason: l10n.t('There are no changes to review.') };
		}

		const ignoreService = this.ignoreService;
		const ignored = await Promise.all(input.map(i => ignoreService.isIgnored(i.document.uri)));
		if (token.isCancellationRequested) {
			return { type: 'cancelled' };
		}
		const filteredInput = input.filter((_, i) => !ignored[i]);
		if (filteredInput.length === 0) {
			this.logService.info('All input documents are ignored. Skipping feedback generation.');
			return {
				type: 'error',
				severity: 'info',
				reason: l10n.t('All input documents are ignored by configuration. Check your .dardcorignore file.')
			};
		}

		const endpoint = await this.endpointProvider.getChatEndpoint('dardcor-utility');

		const prompts: RenderPromptResult[] = [];
		const batches = [filteredInput];
		while (batches.length) {
			const batch = batches.shift()!;
			try {
				const promptRenderer = PromptRenderer.create(this.instantiationService, endpoint, ProvideFeedbackPrompt, {
					input: batch,
					logService: this.logService,
				});
				const prompt = await promptRenderer.render();
				this.logService.debug(`[FeedbackGenerator] Rendered batch of ${batch.length} inputs.`);
				prompts.push(prompt);
			} catch (err) {
				if (err.code === 'split_input') {
					const i = Math.floor(batch.length / 2);
					batches.unshift(batch.slice(0, i), batch.slice(i));
					this.logService.debug(`[FeedbackGenerator] Splitting in batches of ${batches[0].length} and ${batches[1].length} inputs due to token limit.`);
				} else {
					throw err;
				}
			}
		}

		if (token.isCancellationRequested) {
			return { type: 'cancelled' };
		}

		const inputType = filteredInput[0]?.selection ? 'selection' : 'change';
		const maxPrompts = 10;
		if (prompts.length > maxPrompts) {
			return {
				type: 'error',
				reason: inputType === 'selection' ? l10n.t('There is too much text to review, try reviewing a smaller selection.') : l10n.t('There are too many changes to review, try reviewing a smaller set of changes.'),
			};
		}

		const request: ReviewRequest = {
			source: 'dardcorRouter',
			promptCount: prompts.length,
			messageId: generateUuid(),
			inputType,
			inputRanges: filteredInput.map(input => ({
				uri: input.document.uri,
				ranges: input.selection ? [input.selection] : input.change?.hunks.map(hunk => hunk.range) || [],
			})),
		};

		const requestStartTime = Date.now();
		const results = await Promise.all(prompts.map(async prompt => {
			let receivedComments: ReviewComment[] = [];
			const finishedCb = progress ? async (text: string) => {
				const comments = parseReviewComments(request, filteredInput, text, true);
				if (comments.length > receivedComments.length) {
					progress.report(comments.slice(receivedComments.length));
					receivedComments = comments;
				}
				return undefined;
			} : undefined;

			const fetchResult = await endpoint
				.makeChatRequest(
					'feedbackGenerator',
					prompt.messages,
					finishedCb,
					token,
					ChatLocation.Other,
					undefined,
					undefined,
					false,
					{
						messageId: request.messageId,
					}
				);

			const comments = fetchResult.type === 'success' ? parseReviewComments(request, filteredInput, fetchResult.value, false) : [];

			if (progress && comments && comments.length > receivedComments.length) {
				progress.report(comments.slice(receivedComments.length));
				receivedComments = comments;
			}

			return {
				fetchResult,
				comments,
			};
		}));

		const fetchResult = results.find(r => r.fetchResult.type !== 'success')?.fetchResult || results[0].fetchResult;
		const comments = results.map(r => r.comments).flat();

		this.telemetryService.sendMSFTTelemetryEvent('feedback.generateDiagnostics', {
			model: endpoint.model,
			requestId: fetchResult.requestId,
			responseType: fetchResult.type,
			source: request.source,
			messageId: request.messageId,
			documentType: filteredInput[0] && isNotebookCellOrNotebookChatInput(filteredInput[0]?.document.uri) ? 'notebook' : 'text',
			languageId: filteredInput[0]?.document.languageId,
			inputType: request.inputType,
			commentTypes: [...new Set(
				comments?.map(c => knownKinds.has(c.kind) ? c.kind : 'unknown')).values()
			].sort().join(',') || undefined,
		}, {
			promptCount: prompts.length,
			numberOfDiagnostics: comments?.length ?? -1,
			inputDocumentCount: request.inputRanges.length,
			inputLineCount: request.inputRanges
				.reduce((acc, r) => acc + r.ranges
					.reduce((acc, r) => acc + (r.end.line - r.start.line), 0), 0),
			timeToRequest: requestStartTime - startTime,
			timeToComplete: Date.now() - startTime
		});

		return token.isCancellationRequested
			? { type: 'cancelled' }
			: fetchResult.type === 'success'
				? { type: 'success', comments: comments || [] }
				: { type: 'error', reason: fetchResult.reason };
	}
}

const knownKinds = new Set(['bug', 'performance', 'consistency', 'documentation', 'naming', 'readability', 'style', 'other']);

export function parseReviewComments(request: ReviewRequest, input: CurrentChangeInput[], message: string, dropPartial = false): ReviewComment[] {
	const comments: ReviewComment[] = [];

	for (const match of parseFeedbackResponse(message, dropPartial)) {
		const { relativeDocumentPath, from, to, kind, severity, content } = match;
		if (!knownKinds.has(kind)) {
			continue;
		}

		const i = relativeDocumentPath && input.find(i => i.relativeDocumentPath === relativeDocumentPath);
		if (!i) {
			continue;
		}

		const document = i.document;
		const filterRanges = i.selection ? [i.selection!] : i.change?.hunks.map(hunk => hunk.range);

		const fromLine = document.lineAt(from >= 0 ? from : 0);
		const toLine = document.lineAt((to <= document.lineCount ? to : document.lineCount) - 1);
		const lastNonWhitespaceCharacterIndex = toLine.text.trimEnd().length;

		const range = new Range(fromLine.lineNumber, fromLine.firstNonWhitespaceCharacterIndex, toLine.lineNumber, lastNonWhitespaceCharacterIndex);
		if (filterRanges && !filterRanges.some(r => r.intersection(range))) {
			continue;
		}
		const comment: ReviewComment = {
			request,
			document,
			uri: document.uri,
			languageId: document.languageId,
			range,
			body: new MarkdownString(content),
			kind,
			severity,
			originalIndex: comments.length,
			actionCount: 0,
		};
		comments.push(comment);
	}

	return comments;
}

export function parseFeedbackResponse(response: string, dropPartial = false) {
	const regex = /(?<num>\d+)\. Line (?<from>\d+)(-(?<to>\d+))?([^:]*)( in `?(?<relativeDocumentPath>[^,:`]+))`?(, (?<kind>\w+))?(, (?<severity>\w+) severity)?: (?<content>.+?)((?=\n\d+\.|\n\n)|(?<earlyEnd>$))/gs;
	return coalesce(Array.from(response.matchAll(regex), match => {
		const groups = match.groups!;
		if (dropPartial && typeof groups.earlyEnd === 'string') {
			return undefined;
		}
		const from = parseInt(groups.from) - 1;
		const to = groups.to ? parseInt(groups.to) : from + 1;
		const relativeDocumentPath = groups.relativeDocumentPath?.replaceAll(path.sep === '/' ? '\\' : '/', path.sep);
		const kind = groups.kind || 'other';
		const severity = groups.severity || 'unknown';
		let content = groups.content.trim();
		if (content.endsWith('```')) {
			const i = content.lastIndexOf('```', content.length - 4);
			if (i !== -1) {
				content = content.substring(0, i)
					.trim();
			}
		}
		const blockBorders = [...content.matchAll(/```/g)];
		if (blockBorders.length % 2) {
			const odd = blockBorders[blockBorders.length - 1];
			content = content.substring(0, odd.index)
				.trim();
		}
		return {
			relativeDocumentPath,
			from,
			to,
			linkOffset: match.index! + groups.num.length + 2,
			linkLength: 5 + groups.from.length + (groups.to ? groups.to.length + 1 : 0),
			kind,
			severity,
			content
		};
	}));
}

export function sendReviewActionTelemetry(reviewCommentOrComments: ReviewComment | ReviewComment[], totalComments: number, userAction: 'helpful' | 'unhelpful' | string, logService: ILogService, telemetryService: ITelemetryService, instantiationService: IInstantiationService): void {
	logService.debug('[FeedbackGenerator] user feedback received');
	const reviewComments = Array.isArray(reviewCommentOrComments) ? reviewCommentOrComments : [reviewCommentOrComments];
	const reviewComment = reviewComments[0];
	if (!reviewComment) {
		logService.warn('[FeedbackGenerator] No review comment found for user feedback');
		return;
	}

	const userActionProperties = {
		source: reviewComment.request.source,
		messageId: reviewComment.request.messageId,
		userAction,
	};

	const commentType = knownKinds.has(reviewComment.kind) ? reviewComment.kind : 'unknown';
	const sharedProps: TelemetryEventProperties = {
		source: reviewComment.request.source,
		requestId: reviewComment.request.messageId,
		documentType: isNotebookCellOrNotebookChatInput(reviewComment.uri) ? 'notebook' : 'text',
		languageId: reviewComment.languageId,
		inputType: reviewComment.request.inputType,
		commentType,
		userAction,
	};
	const sharedMeasures: TelemetryEventMeasurements = {
		commentIndex: reviewComment.originalIndex,
		actionCount: reviewComment.actionCount,
		inputDocumentCount: reviewComment.request.inputRanges.length,
		inputLineCount: reviewComment.request.inputRanges
			.reduce((acc, r) => acc + r.ranges
				.reduce((acc, r) => acc + (r.end.line - r.start.line), 0), 0),
		promptCount: reviewComment.request.promptCount,
		totalComments,
		comments: reviewComments.length,
		commentLength: reviewComments.reduce((acc, c) => acc + (typeof c.body === 'string' ? c.body.length : c.body.value.length), 0),
	};

	if (userAction === 'helpful' || userAction === 'unhelpful') {
		telemetryService.sendMSFTTelemetryEvent('review.comment.vote', sharedProps, sharedMeasures);
		telemetryService.sendInternalMSFTTelemetryEvent('review.comment.vote', sharedProps);
		sendUserActionTelemetry(telemetryService, undefined, userActionProperties, {}, 'review.comment.vote');
	} else {
		reviewComment.actionCount++;
		telemetryService.sendMSFTTelemetryEvent('review.comment.action', sharedProps, sharedMeasures);
		telemetryService.sendInternalMSFTTelemetryEvent('review.comment.action', sharedProps);
		sendUserActionTelemetry(telemetryService, undefined, userActionProperties, {}, 'review.comment.action');
	}
	if (userAction === 'discardComment') {
		const { document, range } = reviewComment;
		const from = document.offsetAt(range.start);
		const to = document.offsetAt(range.end);
		const text = document.getText(range);
		instantiationService.createInstance(EditSurvivalReporter, document.document, document.getText(), StringEdit.replace(OffsetRange.ofStartAndLength(from, to - from), text), StringEdit.empty, {}, discardCommentSurvivalEvent(sharedProps, sharedMeasures));
	}
}

function discardCommentSurvivalEvent(sharedProps: TelemetryEventProperties | undefined, sharedMeasures: TelemetryEventMeasurements | undefined) {
	return (res: EditSurvivalResult) => {
		res.telemetryService.sendMSFTTelemetryEvent('review.discardCommentRangeSurvival', sharedProps, {
			...sharedMeasures,
			survivalRateFourGram: res.fourGram,
			survivalRateNoRevert: res.noRevert,
			timeDelayMs: res.timeDelayMs,
			didBranchChange: res.didBranchChange ? 1 : 0,
		});
	};
}

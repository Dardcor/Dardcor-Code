/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { disableErrorLogging, parse as parsePartialJson } from 'best-effort-json-parser';
import type { ChatResponseStream, ChatVulnerability } from 'vscode';
import { IResponsePart } from '../../../platform/chat/common/chatMLFetcher';
import { IResponseDelta } from '../../../platform/networking/common/fetch';
import { FilterReason } from '../../../platform/networking/common/openai';
import { isEncryptedThinkingDelta } from '../../../platform/thinking/common/thinking';
import { CancellationToken } from '../../../util/dardcor/base/common/cancellation';
import { URI } from '../../../util/dardcor/base/common/uri';
import { ChatResponseClearToPreviousToolInvocationReason } from '../../../dardcorTypes';
import { getContributedToolName } from '../../tools/common/toolNames';
import { IResponseProcessor, IResponseProcessorContext } from './intents';

disableErrorLogging();

export interface StartStopMapping {
	readonly stop: string;
	readonly start?: string;
}

export class PseudoStopStartResponseProcessor implements IResponseProcessor {
	private stagedDeltasToApply: IResponseDelta[] = [];
	private currentStartStop: StartStopMapping | undefined = undefined;
	private nonReportedDeltas: IResponseDelta[] = [];
	private thinkingActive: boolean = false;

	private static readonly _toolStreamThrottleMs = 100;
	private readonly _lastToolStreamUpdate = new Map<string, number>();
	private readonly _pendingToolStreamUpdates = new Map<string, { id: string; arguments: string | undefined }>();

	constructor(
		private readonly stopStartMappings: readonly StartStopMapping[],
		private readonly processNonReportedDelta: ((deltas: IResponseDelta[]) => string[]) | undefined,
		private readonly options?: { subagentInvocationId?: string }
	) { }

	async processResponse(_context: IResponseProcessorContext, inputStream: AsyncIterable<IResponsePart>, outputStream: ChatResponseStream, token: CancellationToken): Promise<void> {
		return this.doProcessResponse(inputStream, outputStream, token);
	}

	async doProcessResponse(responseStream: AsyncIterable<IResponsePart>, progress: ChatResponseStream, token: CancellationToken): Promise<void> {
		try {
			for await (const { delta } of responseStream) {
				if (token.isCancellationRequested) {
					return;
				}
				this.applyDelta(delta, progress);
			}
		} finally {
			if (token.isCancellationRequested) {
				this._clearPendingToolStreamUpdates();
			} else {
				this._flushPendingToolStreamUpdates(progress);
			}
		}
	}

	private _clearPendingToolStreamUpdates(): void {
		this._pendingToolStreamUpdates.clear();
		this._lastToolStreamUpdate.clear();
	}

	private _flushPendingToolStreamUpdates(progress: ChatResponseStream): void {
		for (const update of this._pendingToolStreamUpdates.values()) {
			progress.updateToolInvocation(update.id, { partialInput: tryParsePartialToolInput(update.arguments) });
		}
		this._clearPendingToolStreamUpdates();
	}

	protected applyDeltaToProgress(delta: IResponseDelta, progress: ChatResponseStream) {
		if (delta.thinking) {
			if (!isEncryptedThinkingDelta(delta.thinking) || delta.thinking.text) {
				progress.thinkingProgress(delta.thinking);
				this.thinkingActive = true;
			}
		} else if (this.thinkingActive) {
			progress.thinkingProgress({ id: '', text: '', metadata: { vscodeReasoningDone: true, stopReason: delta.text ? 'text' : 'other' } });
			this.thinkingActive = false;
		}

		reportCitations(delta, progress);

		const vulnerabilities: ChatVulnerability[] | undefined = delta.codeVulnAnnotations?.map(a => ({ title: a.details.type, description: a.details.description }));
		if (vulnerabilities?.length) {
			progress.markdownWithVulnerabilities(delta.text ?? '', vulnerabilities);
		} else if (delta.text) {
			progress.markdown(delta.text);
		}

		if (delta.beginToolCalls?.length) {
			for (const beginCall of delta.beginToolCalls) {
				progress.beginToolInvocation(beginCall.id ?? '', getContributedToolName(beginCall.name), { subagentInvocationId: this.options?.subagentInvocationId });
			}
		}

		if (delta.dardcorToolCallStreamUpdates?.length) {
			const now = Date.now();
			for (const update of delta.dardcorToolCallStreamUpdates) {
				if (!update.name) {
					continue;
				}
				const toolId = update.id ?? '';
				const lastUpdate = this._lastToolStreamUpdate.get(toolId) ?? 0;
				if (now - lastUpdate >= PseudoStopStartResponseProcessor._toolStreamThrottleMs) {
					this._lastToolStreamUpdate.set(toolId, now);
					this._pendingToolStreamUpdates.delete(toolId);
					progress.updateToolInvocation(toolId, { partialInput: tryParsePartialToolInput(update.arguments) });
				} else {
					this._pendingToolStreamUpdates.set(toolId, { id: toolId, arguments: update.arguments });
				}
			}
		}
	}

	private updateStagedDeltasUpToIndex(stopWordIdx: number, length: number): IResponseDelta[] {
		const result: IResponseDelta[] = [];
		for (let deltaOffset = 0; deltaOffset < stopWordIdx + length;) {
			const delta = this.stagedDeltasToApply.shift();
			if (delta) {
				if (deltaOffset + delta.text.length <= stopWordIdx) {
					result.push(delta);
				} else if (deltaOffset < stopWordIdx || deltaOffset < stopWordIdx + length) {
					if (deltaOffset < stopWordIdx) {
						const prefixDelta = { ...delta };
						prefixDelta.text = delta.text.substring(0, stopWordIdx - deltaOffset);
						result.push(prefixDelta);
					}

					const postfixDelta = { ...delta };
					postfixDelta.text = delta.text.substring((stopWordIdx - deltaOffset) + length);
					if (postfixDelta.text) {
						this.stagedDeltasToApply.unshift(postfixDelta);
					}

				} else {
				}

				deltaOffset += delta.text.length;
			} else {
				break;
			}
		}

		return result;
	}

	protected checkForKeyWords(pseudoStopWords: string[], delta: IResponseDelta, applyDeltaToProgress: (delta: IResponseDelta) => void): string | undefined {
		const textDelta = this.stagedDeltasToApply.map(d => d.text).join('') + delta.text;

		for (const pseudoStopWord of pseudoStopWords) {
			const stopWordIndex = textDelta.indexOf(pseudoStopWord);
			if (stopWordIndex === -1) {
				continue;
			}

			this.stagedDeltasToApply.push(delta);
			const deltasToReport = this.updateStagedDeltasUpToIndex(stopWordIndex, pseudoStopWord.length);
			deltasToReport.forEach(item => applyDeltaToProgress(item));

			return pseudoStopWord;
		}

		for (const pseudoStopWord of pseudoStopWords) {
			for (let i = pseudoStopWord.length - 1; i > 0; i--) {
				const partialStopWord = pseudoStopWord.substring(0, i);
				if (textDelta.endsWith(partialStopWord)) {
					this.stagedDeltasToApply = [...this.stagedDeltasToApply, delta];
					return;
				}
			}
		}

		[...this.stagedDeltasToApply, delta].forEach(item => {
			applyDeltaToProgress(item);
		});
		this.stagedDeltasToApply = [];

		return;
	}

	private postReportRecordProgress(delta: IResponseDelta) {
		this.nonReportedDeltas.push(delta);
	}

	protected applyDelta(delta: IResponseDelta, progress: ChatResponseStream): void {
		if (delta.retryReason) {
			this.stagedDeltasToApply = [];
			this.currentStartStop = undefined;
			this.nonReportedDeltas = [];
			this.thinkingActive = false;
			this._clearPendingToolStreamUpdates();
			if (delta.retryReason === 'network_error' || delta.retryReason === 'server_error') {
				progress.clearToPreviousToolInvocation(ChatResponseClearToPreviousToolInvocationReason.NoReason);
			} else if (delta.retryReason === FilterReason.Copyright) {
				progress.clearToPreviousToolInvocation(ChatResponseClearToPreviousToolInvocationReason.CopyrightContentRetry);
			} else {
				progress.clearToPreviousToolInvocation(ChatResponseClearToPreviousToolInvocationReason.FilteredContentRetry);
			}
			return;
		}
		if (this.currentStartStop === undefined) {
			const stopWord = this.checkForKeyWords(this.stopStartMappings.map(e => e.stop), delta, delta => this.applyDeltaToProgress(delta, progress));
			if (stopWord) {
				this.currentStartStop = this.stopStartMappings.find(e => e.stop === stopWord);
			}
			return;
		} else {
			if (!this.currentStartStop.start) {
				return;
			}
			const startWord = this.checkForKeyWords([this.currentStartStop.start], delta, this.postReportRecordProgress.bind(this));
			if (startWord) {
				if (this.processNonReportedDelta) {
					const postProcessed = this.processNonReportedDelta(this.nonReportedDeltas);
					postProcessed.forEach((text) => this.applyDeltaToProgress({ text }, progress));
				}

				this.currentStartStop = undefined;
				if (this.stagedDeltasToApply.length > 0) {
					this.applyDelta({ text: '' }, progress);
				}
			}
		}
	}
}

export function reportCitations(delta: IResponseDelta, progress: ChatResponseStream): void {
	const citations = delta.ipCitations;
	if (citations?.length) {
		citations.forEach(c => {
			const licenseLabel = c.citations.license === 'NOASSERTION' ?
				l10n.t('unknown') :
				c.citations.license;
			progress.codeCitation(URI.parse(c.citations.url), licenseLabel, c.citations.snippet);
		});
	}
}

function tryParsePartialToolInput(raw: string | undefined): unknown {
	if (!raw) {
		return raw;
	}

	try {
		return parsePartialJson(raw);
	} catch {
		return undefined;
	}
}

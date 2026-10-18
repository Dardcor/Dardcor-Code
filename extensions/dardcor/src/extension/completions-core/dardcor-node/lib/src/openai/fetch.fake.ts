/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'vscode';
import { generateUuid } from '../../../../../../util/dardcor/base/common/uuid';
import { getTokenizer } from '../../../prompt/src/tokenization';
import { TelemetryWithExp } from '../telemetry';
import {
	CompletionError,
	CompletionParams,
	CompletionResults,
	FinishedCallback,
	OpenAIFetcher,
	PostOptions,
	postProcessChoices,
	SolutionDecision,
} from './fetch';
import { APIChoice } from './openai';


export function fakeAPIChoice(
	headerRequestId: string,
	choiceIndex: number,
	completionText: string,
	telemetryData: TelemetryWithExp = TelemetryWithExp.createEmptyConfigForTesting()
): APIChoice {
	const tokenizer = getTokenizer();

	return {
		completionText: completionText,
		meanLogProb: 0.5,
		meanAlternativeLogProb: 0.5,
		numTokens: -1,
		choiceIndex,
		requestId: {
			headerRequestId,
			serverExperiments: 'dummy',
			deploymentId: 'dummy',
			gitHubRequestId: 'dummy',
			completionId: 'dummy',
			created: 0
		},
		telemetryData,
		tokens: tokenizer
			.tokenize(completionText)
			.map(token => tokenizer.detokenize([token]))
			.concat(),
		blockFinished: false,
		clientCompletionId: generateUuid(),
		finishReason: 'stop',
	};
}

export function fakeAPIChoiceFromCompletion(completion: string): APIChoice {
	return fakeAPIChoice(generateUuid(), 0, completion);
}

export async function* fakeAPIChoices(
	postOptions: PostOptions | undefined,
	finishedCb: FinishedCallback,
	completions: string[],
	telemetryData?: TelemetryWithExp
): AsyncIterable<APIChoice> {
	const fakeHeaderRequestId = generateUuid();
	let choiceIndex = 0;
	for (let completion of completions) {
		let stopOffset = -1;
		if (postOptions?.stop !== undefined) {
			for (const stopToken of postOptions.stop) {
				const thisStopOffset = completion.indexOf(stopToken);
				if (thisStopOffset !== -1 && (stopOffset === -1 || thisStopOffset < stopOffset)) {
					stopOffset = thisStopOffset;
				}
			}
		}
		if (stopOffset !== -1) {
			completion = completion.substring(0, stopOffset);
		}
		const finishOffset = asNumericOffset(await finishedCb(completion, { text: completion }));
		if (finishOffset !== undefined) {
			completion = completion.substring(0, finishOffset);
		}
		const choice = fakeAPIChoice(fakeHeaderRequestId, choiceIndex++, completion, telemetryData);
		choice.blockFinished = finishOffset === undefined ? false : true;
		yield choice;
	}
}

function asNumericOffset(result: SolutionDecision | number | undefined): number | undefined {
	if (typeof result === 'number' || result === undefined) {
		return result;
	}
	return result.finishOffset;
}

function fakeResponse(
	completions: string[],
	finishedCb: FinishedCallback,
	postOptions?: PostOptions,
	telemetryData?: TelemetryWithExp
): Promise<CompletionResults> {
	const choices = postProcessChoices(fakeAPIChoices(postOptions, finishedCb, completions, telemetryData));
	return Promise.resolve({ type: 'success', choices, getProcessingTime: () => 0 });
}

export class SyntheticCompletions extends OpenAIFetcher {
	private _wasCalled = false;

	constructor(
		private readonly _completions: string[],
	) {
		super();
	}

	async fetchAndStreamCompletions(
		params: CompletionParams,
		baseTelemetryData: TelemetryWithExp,
		finishedCb: FinishedCallback,
		cancel?: CancellationToken,
		teletryProperties?: { [key: string]: string }
	): Promise<CompletionResults | CompletionError> {
		if (cancel?.isCancellationRequested) {
			return { type: 'canceled', reason: 'canceled during test' };
		}

		if (!this._wasCalled) {
			this._wasCalled = true;
			return fakeResponse(this._completions, finishedCb, params.postOptions, baseTelemetryData);
		} else {
			const emptyCompletions = this._completions.map(completion => '');
			return fakeResponse(emptyCompletions, finishedCb, params.postOptions, baseTelemetryData);
		}
	}
}

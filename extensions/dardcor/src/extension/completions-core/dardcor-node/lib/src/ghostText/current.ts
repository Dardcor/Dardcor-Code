/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { createServiceIdentifier } from '../../../../../../util/common/services';
import { APIChoice } from '../openai/openai';
import { ResultType } from './resultType';

export const ICompletionsCurrentGhostText = createServiceIdentifier<ICompletionsCurrentGhostText>('ICompletionsCurrentGhostText');
export interface ICompletionsCurrentGhostText {
	readonly _serviceBrand: undefined;

	readonly clientCompletionId: string | undefined;

	currentRequestId: string | undefined;

	setGhostText(prefix: string, suffix: string, choices: APIChoice[], resultType: ResultType): void;
	getCompletionsForUserTyping(prefix: string, suffix: string): APIChoice[] | undefined;
	hasAcceptedCurrentCompletion(prefix: string, suffix: string): boolean;
}

export class CurrentGhostText implements ICompletionsCurrentGhostText {
	declare _serviceBrand: undefined;
	private prefix?: string;

	private suffix?: string;

	private choices: APIChoice[] = [];

	get clientCompletionId(): string | undefined {
		return this.choices[0]?.clientCompletionId;
	}

	currentRequestId: string | undefined;

	setGhostText(prefix: string, suffix: string, choices: APIChoice[], resultType: ResultType) {
		if (resultType === ResultType.TypingAsSuggested) { return; }
		this.prefix = prefix;
		this.suffix = suffix;
		this.choices = choices;
	}

	getCompletionsForUserTyping(prefix: string, suffix: string): APIChoice[] | undefined {
		const remainingPrefix = this.getRemainingPrefix(prefix, suffix);
		if (remainingPrefix === undefined) { return; }
		if (!startsWithAndExceeds(this.choices[0].completionText, remainingPrefix)) { return; }
		return adjustChoicesStart(this.choices, remainingPrefix);
	}

	hasAcceptedCurrentCompletion(prefix: string, suffix: string): boolean {
		const remainingPrefix = this.getRemainingPrefix(prefix, suffix);
		if (remainingPrefix === undefined) { return false; }

		const exactMatch = remainingPrefix === this.choices?.[0].completionText;

		const finishReason = this.choices?.[0].finishReason;
		return exactMatch && finishReason === 'stop';
	}

	private getRemainingPrefix(prefix: string, suffix: string): string | undefined {
		if (this.prefix === undefined || this.suffix === undefined || this.choices.length === 0) { return; }
		if (this.suffix !== suffix) { return; }
		if (!prefix.startsWith(this.prefix)) { return; }
		return prefix.substring(this.prefix.length);
	}
}

function adjustChoicesStart(choices: APIChoice[], remainingPrefix: string): APIChoice[] {
	return choices
		.filter(choice => startsWithAndExceeds(choice.completionText, remainingPrefix))
		.map(choice => ({
			...choice,
			completionText: choice.completionText.substring(remainingPrefix.length),
		}));
}

function startsWithAndExceeds(text: string, prefix: string) {
	return text.startsWith(prefix) && text.length > prefix.length;
}

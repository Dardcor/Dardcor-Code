/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export interface IQuestionAnswer {
	selected: string[];
	freeText: string | null;
	skipped: boolean;
}

export interface IAnswerResult {
	answers: Record<string, IQuestionAnswer>;
}

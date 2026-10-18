/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVoicePendingQuestion } from './voiceClientService.js';

export function formatQuestionPrompt(question: IVoicePendingQuestion, allowSkip: boolean): string {
	const parts: string[] = [];
	const title = question.title.trim();
	if (title) {
		parts.push(title);
	}
	if (question.options.length > 0) {
		const choices = question.options.map((option, index) => `${index + 1}, ${option.label}`).join('. ');
		parts.push(`Options: ${choices}.`);
		if (question.allow_freeform) {
			parts.push('You can also give your own answer.');
		}
	}
	if (allowSkip) {
		parts.push('Or say skip.');
	}
	return parts.join(' ');
}

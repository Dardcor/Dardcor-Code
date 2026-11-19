/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatInputRequestPurpose, withChatInputRequestPurpose } from '../../common/meta/agentChatInputRequestMeta.js';
import { ChatInputAnswerState, ChatInputAnswerValueKind, ChatInputQuestionKind, ChatInputResponseKind, type ChatInputAnswer, type ChatInputQuestion, type ChatInputRequest } from '../../common/state/sessionState.js';
import type { ToolRequestUserInputAnswer } from './protocol/generated/v2/ToolRequestUserInputAnswer.js';
import type { ToolRequestUserInputQuestion } from './protocol/generated/v2/ToolRequestUserInputQuestion.js';
import type { ToolRequestUserInputResponse } from './protocol/generated/v2/ToolRequestUserInputResponse.js';

export function buildUserInputRequest(requestId: string, questions: readonly ToolRequestUserInputQuestion[]): ChatInputRequest {
	return withChatInputRequestPurpose({
		id: requestId,
		questions: questions.map((q): ChatInputQuestion => {
			if (q.options && q.options.length > 0) {
				return {
					kind: ChatInputQuestionKind.SingleSelect,
					id: q.id,
					title: q.header,
					message: q.question,
					required: true,
					options: q.options.map(o => ({ id: o.label, label: o.label, description: o.description || undefined })),
					allowFreeformInput: q.isOther,
				};
			}
			return {
				kind: ChatInputQuestionKind.Text,
				id: q.id,
				title: q.header,
				message: q.question,
				required: true,
			};
		}),
	}, ChatInputRequestPurpose.AskUser);
}

export function userInputResponseFromAnswers(
	questions: readonly ToolRequestUserInputQuestion[],
	response: ChatInputResponseKind,
	answers: Record<string, ChatInputAnswer> | undefined,
): ToolRequestUserInputResponse {
	const out: Record<string, ToolRequestUserInputAnswer> = {};
	for (const q of questions) {
		out[q.id] = { answers: answerStrings(answers?.[q.id], response) };
	}
	return { answers: out };
}

export function emptyUserInputResponse(questions: readonly ToolRequestUserInputQuestion[]): ToolRequestUserInputResponse {
	const out: Record<string, ToolRequestUserInputAnswer> = {};
	for (const q of questions) {
		out[q.id] = { answers: [] };
	}
	return { answers: out };
}

export function answerStrings(answer: ChatInputAnswer | undefined, response: ChatInputResponseKind): string[] {
	if (response !== ChatInputResponseKind.Accept || !answer || answer.state === ChatInputAnswerState.Skipped) {
		return [];
	}
	const { value } = answer;
	switch (value.kind) {
		case ChatInputAnswerValueKind.Text:
			return [value.value];
		case ChatInputAnswerValueKind.Number:
		case ChatInputAnswerValueKind.Boolean:
			return [String(value.value)];
		case ChatInputAnswerValueKind.Selected:
			return [value.value, ...(value.freeformValues ?? [])];
		case ChatInputAnswerValueKind.SelectedMany:
			return [...value.value, ...(value.freeformValues ?? [])];
	}
}

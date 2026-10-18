/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfirmationOptionKind, ChatInputAnswerState, ChatInputAnswerValueKind, ChatInputQuestionKind, ToolCallStatus, type ChatInputOption, type ChatInputQuestion, type ToolCallPendingConfirmationState } from '../../common/state/protocol/state.js';
import type { ChatInputAnswer } from '../../common/state/sessionState.js';
import { getClaudeToolDisplayName } from './claudeToolDisplay.js';



export function buildExitPlanModeConfirmationState(input: Record<string, unknown>, toolUseID: string): ToolCallPendingConfirmationState {
	const plan = typeof input.plan === 'string' ? input.plan : '';
	return {
		status: ToolCallStatus.PendingConfirmation,
		toolCallId: toolUseID,
		toolName: 'ExitPlanMode',
		displayName: getClaudeToolDisplayName('ExitPlanMode'),
		invocationMessage: { markdown: plan },
		toolInput: JSON.stringify(input),
		confirmationTitle: localize('claude.exitPlanMode.title', "Ready to code?"),
		options: [
			{ id: 'approve', label: localize('claude.exitPlanMode.approve', "Approve"), kind: ConfirmationOptionKind.Approve },
			{ id: 'deny', label: localize('claude.exitPlanMode.deny', "Deny"), kind: ConfirmationOptionKind.Deny },
		],
	};
}



export interface ParsedAskUserQuestionInput {
	readonly questions: ReadonlyArray<{
		readonly question: string;
		readonly header: string;
		readonly options: ReadonlyArray<{ label: string; description?: string }>;
		readonly multiSelect?: boolean;
		readonly allowFreeformInput?: boolean;
	}>;
}

export function parseAskUserQuestionInput(input: Record<string, unknown>): ParsedAskUserQuestionInput | undefined {
	const askInput = input as Partial<ParsedAskUserQuestionInput>;
	if (!askInput.questions?.length) {
		return undefined;
	}
	return { questions: askInput.questions };
}

function askUserQuestionId(header: string, idx: number): string {
	return header || `q-${idx}`;
}

export function buildAskUserSessionInputQuestions(askInput: ParsedAskUserQuestionInput): ChatInputQuestion[] {
	return askInput.questions.map((q, idx) => {
		const opts: ChatInputOption[] = q.options.map(opt => ({
			id: opt.label,
			label: opt.label,
			...(opt.description !== undefined ? { description: opt.description } : {}),
		}));
		const id = askUserQuestionId(q.header, idx);
		return q.multiSelect
			? {
				id,
				kind: ChatInputQuestionKind.MultiSelect,
				title: q.header,
				message: q.question,
				options: opts,
				allowFreeformInput: q.allowFreeformInput ?? false,
			}
			: {
				id,
				kind: ChatInputQuestionKind.SingleSelect,
				title: q.header,
				message: q.question,
				options: opts,
				allowFreeformInput: q.allowFreeformInput ?? false,
			};
	});
}

export function flattenAskUserAnswers(askInput: ParsedAskUserQuestionInput, answers: Record<string, ChatInputAnswer>): Record<string, string> {
	const result: Record<string, string> = {};
	for (let idx = 0; idx < askInput.questions.length; idx++) {
		const q = askInput.questions[idx];
		const a = answers[askUserQuestionId(q.header, idx)];
		if (!a || a.state === ChatInputAnswerState.Skipped) {
			continue;
		}
		const parts: string[] = [];
		const value = a.value;
		if (value.kind === ChatInputAnswerValueKind.Selected) {
			if (value.value) { parts.push(value.value); }
			if (value.freeformValues) { parts.push(...value.freeformValues); }
		} else if (value.kind === ChatInputAnswerValueKind.SelectedMany) {
			parts.push(...value.value);
			if (value.freeformValues) { parts.push(...value.freeformValues); }
		} else if (value.kind === ChatInputAnswerValueKind.Text) {
			parts.push(value.value);
		}
		if (parts.length > 0) {
			result[q.question] = parts.join(', ');
		}
	}
	return result;
}


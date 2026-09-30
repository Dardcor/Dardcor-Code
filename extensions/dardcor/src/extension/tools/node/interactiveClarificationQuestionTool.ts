/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../dardcorTypes';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

export interface IQuestionItem {
	question: string;
	options: Array<{ label: string; description?: string }>;
	isMultiSelect?: boolean;
	allowCustomResponse?: boolean;
}

export interface IInteractiveQuestionParams {
	questions: IQuestionItem[];
}

export class InteractiveClarificationQuestionTool implements ICopilotTool<IInteractiveQuestionParams> {
	public static readonly toolName = ToolName.InteractiveClarificationQuestion;

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IInteractiveQuestionParams>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
		const { questions } = options.input;

		if (!questions || questions.length === 0) {
			throw new Error('At least one question must be provided.');
		}

		const answers: Array<{ question: string; selected: string[]; customAnswer?: string }> = [];

		for (const q of questions) {
			if (token.isCancellationRequested) {
				return new LanguageModelToolResult([
					new LanguageModelTextPart('Question modal cancelled by user.')
				]);
			}

			const customOptionItem = {
				label: '$(edit) Type custom response...',
				description: 'Enter your own custom instruction or answer'
			};

			const pickItems = [
				...q.options.map(opt => ({
					label: opt.label,
					description: opt.description
				})),
				...(q.allowCustomResponse !== false ? [customOptionItem] : [])
			];

			const selected = await vscode.window.showQuickPick(pickItems, {
				title: q.question,
				placeHolder: 'Select an option to guide the agent...',
				canPickMany: q.isMultiSelect ?? false,
				ignoreFocusOut: true
			});

			if (!selected) {
				answers.push({
					question: q.question,
					selected: ['(User skipped this question)']
				});
				continue;
			}

			if (Array.isArray(selected)) {
				const selectedLabels = selected.map(s => s.label);
				const hasCustom = selectedLabels.includes(customOptionItem.label);

				let customInput: string | undefined;
				if (hasCustom) {
					customInput = await vscode.window.showInputBox({
						title: q.question,
						prompt: 'Enter your specific custom answer for the agent:',
						ignoreFocusOut: true
					});
				}

				answers.push({
					question: q.question,
					selected: selectedLabels.filter(l => l !== customOptionItem.label),
					customAnswer: customInput
				});
			} else {
				if (selected.label === customOptionItem.label) {
					const customInput = await vscode.window.showInputBox({
						title: q.question,
						prompt: 'Enter your specific custom answer for the agent:',
						ignoreFocusOut: true
					});

					answers.push({
						question: q.question,
						selected: [],
						customAnswer: customInput || '(No text provided)'
					});
				} else {
					answers.push({
						question: q.question,
						selected: [selected.label]
					});
				}
			}
		}

		const resultMarkdown = [
			`### User Clarification Answers`,
			...answers.map((ans, idx) => {
				const selections = ans.selected.length > 0 ? ans.selected.join(', ') : 'None';
				const custom = ans.customAnswer ? `\n  - **Custom Response:** "${ans.customAnswer}"` : '';
				return `${idx + 1}. **${ans.question}**\n  - **Selected:** ${selections}${custom}`;
			}),
			``,
			`You can now proceed confidently with the user's explicit guidance.`
		].join('\n');

		return new LanguageModelToolResult([
			new LanguageModelTextPart(resultMarkdown)
		]);
	}
}

ToolRegistry.registerTool(InteractiveClarificationQuestionTool);

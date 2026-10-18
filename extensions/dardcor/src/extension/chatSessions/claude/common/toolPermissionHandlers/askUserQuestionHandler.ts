/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AskUserQuestionInput } from '@anthropic-ai/claude-agent-sdk/sdk-tools';
import { CancellationToken } from '../../../../../util/dardcor/base/common/cancellation';
import { LanguageModelTextPart } from '../../../../../dardcorTypes';
import { IAnswerResult } from '../../../../tools/common/askQuestionsTypes';
import { ToolName } from '../../../../tools/common/toolNames';
import { IToolsService } from '../../../../tools/common/toolsService';
import {
	ClaudeToolPermissionContext,
	ClaudeToolPermissionResult,
	IClaudeToolPermissionHandler
} from '../claudeToolPermission';
import { registerToolPermissionHandler } from '../claudeToolPermissionRegistry';
import { ClaudeToolNames } from '../claudeTools';

export class AskUserQuestionHandler implements IClaudeToolPermissionHandler<ClaudeToolNames.AskUserQuestion> {
	public readonly toolNames = [ClaudeToolNames.AskUserQuestion] as const;

	constructor(
		@IToolsService private readonly toolsService: IToolsService,
	) { }

	public async handle(
		_toolName: ClaudeToolNames.AskUserQuestion,
		input: AskUserQuestionInput,
		context: ClaudeToolPermissionContext
	): Promise<ClaudeToolPermissionResult> {
		try {
			const result = await this.toolsService.invokeTool(ToolName.CoreAskQuestions, {
				input,
				toolInvocationToken: context.toolInvocationToken,
			}, CancellationToken.None);

			const firstPart = result.content.at(0);
			if (!(firstPart instanceof LanguageModelTextPart)) {
				return {
					behavior: 'deny',
					message: 'The user cancelled the question'
				};
			}

			const toolResult: IAnswerResult = JSON.parse(firstPart.value);

			const allSkipped = Object.values(toolResult.answers).every(a => a.skipped);
			if (allSkipped) {
				return {
					behavior: 'deny',
					message: 'The user cancelled the question'
				};
			}

			const answers: Record<string, string> = {};
			for (const questionItem of input.questions) {
				const answer = toolResult.answers[questionItem.header];
				if (answer && !answer.skipped) {
					const parts: string[] = [...answer.selected];
					if (answer.freeText) {
						parts.push(answer.freeText);
					}
					answers[questionItem.question] = parts.join(', ');
				}
			}

			return {
				behavior: 'allow',
				updatedInput: {
					...input,
					answers
				}
			};
		} catch {
			return {
				behavior: 'deny',
				message: 'The user cancelled the question'
			};
		}
	}
}

registerToolPermissionHandler(
	[ClaudeToolNames.AskUserQuestion],
	AskUserQuestionHandler
);

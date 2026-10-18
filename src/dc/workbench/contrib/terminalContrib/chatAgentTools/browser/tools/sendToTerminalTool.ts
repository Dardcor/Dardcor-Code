/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { appendEscapedMarkdownInlineCode, createCommandUri, isMarkdownString, MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../../nls.js';
import { CommandsRegistry } from '../../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { hasKey } from '../../../../../../base/common/types.js';
import { IChatWidgetService } from '../../../../chat/browser/chat.js';
import { IChatService, IChatMultiSelectAnswer, IChatQuestionAnswerValue, IChatQuestionCarousel, IChatSingleSelectAnswer } from '../../../../chat/common/chatService/chatService.js';
import { ToolDataSource, type CountTokensCallback, type IPreparedToolInvocation, type IToolData, type IToolImpl, type IToolInvocation, type IToolInvocationPreparationContext, type IToolResult, type ToolProgress } from '../../../../chat/common/tools/languageModelToolsService.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ITerminalChatService, ITerminalInstance, ITerminalService } from '../../../../terminal/browser/terminal.js';
import { getOutput } from '../outputHelpers.js';
import { buildCommandDisplayText, isMultilineCommand, normalizeCommandForExecution } from '../runInTerminalHelpers.js';
import { RunInTerminalTool } from './runInTerminalTool.js';
import { isSessionAutoApproveLevel } from './terminalToolAutoApprove.js';
import { TerminalToolId } from './toolIds.js';

export const SendToTerminalToolData: IToolData = {
	id: TerminalToolId.SendToTerminal,
	toolReferenceName: 'sendToTerminal',
	displayName: localize('sendToTerminalTool.displayName', 'Send to Terminal'),
	modelDescription: `Send input text to an active terminal execution (identified by the \`id\` returned from ${TerminalToolId.RunInTerminal}). The 'command' field may be empty or whitespace to press Enter (useful for interactive prompts). By default, returns the last 20 lines of terminal output captured shortly after sending. Set 'waitForOutput' to true for interactive programs (games, REPLs, etc.) to wait until the terminal becomes idle before returning output — this gives you the program's response to your input.`,
	icon: Codicon.terminal,
	source: ToolDataSource.Internal,
	inputSchema: {
		type: 'object',
		properties: {
			id: {
				type: 'string',
				description: `The ID of an active terminal execution to send a command to (returned by ${TerminalToolId.RunInTerminal} for async executions, or for sync executions that timed out and were moved to the background).`,
				pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
			},
			command: {
				type: 'string',
				description: 'The input text to send to the terminal. The text is sent followed by Enter. Provide an empty or whitespace string to send just Enter (for interactive prompts).'
			},
			waitForOutput: {
				type: 'boolean',
				description: 'When true, waits for the terminal to become idle (no new output for a short period) before returning, instead of returning immediately. Use this for interactive programs where you need to see the full response to your input. Defaults to false.'
			},
		},
		required: [
			'id',
			'command',
		]
	}
};

export interface ISendToTerminalInputParams {
	id: string;
	command: string;
	waitForOutput?: boolean;
}

function isCancelSignal(command: string): boolean {
	return /^[\u0003\u0004\u001c]$/.test(command.trim());
}

const FocusTerminalByIdCommandId = 'workbench.action.terminal.chat.focusTerminalById';
CommandsRegistry.registerCommand(FocusTerminalByIdCommandId, async (accessor, instanceId: number) => {
	const terminalService = accessor.get(ITerminalService);
	const instance = terminalService.getInstanceFromId(instanceId);
	if (instance && !instance.shellLaunchConfig.hideFromUser) {
		terminalService.setActiveInstance(instance);
		await terminalService.revealActiveTerminal();
		instance.focus();
	}
});

const FocusTerminalByExecutionIdCommandId = 'workbench.action.terminal.chat.focusTerminalByExecutionId';
CommandsRegistry.registerCommand(FocusTerminalByExecutionIdCommandId, async (accessor, executionId: string) => {
	const execution = RunInTerminalTool.getExecution(executionId);
	if (execution && !execution.instance.shellLaunchConfig.hideFromUser) {
		const terminalService = accessor.get(ITerminalService);
		terminalService.setActiveInstance(execution.instance);
		await terminalService.revealActiveTerminal();
		execution.instance.focus();
	}
});

export class SendToTerminalTool extends Disposable implements IToolImpl {

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IChatService private readonly _chatService: IChatService,
		@IChatWidgetService private readonly _chatWidgetService: IChatWidgetService,
		@ITerminalChatService private readonly _terminalChatService: ITerminalChatService,
	) {
		super();
	}

	async prepareToolInvocation(context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const args = context.parameters as ISendToTerminalInputParams;
		const isEmptyInput = !args.command || !args.command.trim();

		const terminalLabel = this._getTerminalLabel(args);

		const invocationMessage = new MarkdownString();
		const pastTenseMessage = new MarkdownString();

		const questionText = this._getQuestionContextForTerminal(context.chatSessionResource, args);

		if (isEmptyInput) {
			invocationMessage.appendMarkdown(localize('send.progressive.enter', "Pressing `Enter` in terminal"));
			pastTenseMessage.appendMarkdown(localize('send.past.enter', "Pressed `Enter` in terminal"));
		} else {
			const displayCommand = buildCommandDisplayText(args.command);
			const safeInlineCode = appendEscapedMarkdownInlineCode(displayCommand);
			invocationMessage.appendMarkdown(localize('send.progressive', "Sending {0} to terminal", safeInlineCode));
			pastTenseMessage.appendMarkdown(localize('send.past', "Sent {0} to terminal", safeInlineCode));
		}

		if (questionText) {
			const replyPrefix = ` (${localize('send.replyingTo', "replying to: ")}`;
			invocationMessage.appendMarkdown(replyPrefix);
			invocationMessage.appendText(questionText);
			invocationMessage.appendMarkdown(')');
			pastTenseMessage.appendMarkdown(replyPrefix);
			pastTenseMessage.appendText(questionText);
			pastTenseMessage.appendMarkdown(')');
		}

		const instanceId = this._getTerminalInstanceId(args);
		const confirmationMessage = new MarkdownString('', { isTrusted: { enabledCommands: [FocusTerminalByIdCommandId] } });
		const safeTerminalLabel = appendEscapedMarkdownInlineCode(terminalLabel);
		const baseMessage = isEmptyInput
			? localize('send.confirm.message.enter', "Press `Enter` in terminal {0}", safeTerminalLabel)
			: localize('send.confirm.message', "Run {0} in terminal {1}", appendEscapedMarkdownInlineCode(buildCommandDisplayText(args.command)), safeTerminalLabel);
		if (instanceId !== undefined) {
			const focusUri = createCommandUri(FocusTerminalByIdCommandId, instanceId);
			confirmationMessage.appendMarkdown(`${baseMessage} — [${localize('focusTerminal', "Focus Terminal")}](${focusUri})`);
		} else {
			confirmationMessage.appendMarkdown(baseMessage);
		}

		const chatSessionResource = context.chatSessionResource;
		const isSessionAutoApproved = chatSessionResource && (
			isSessionAutoApproveLevel(chatSessionResource, this._configurationService, this._chatWidgetService, this._chatService) ||
			this._terminalChatService.hasChatSessionAutoApproval(chatSessionResource)
		);

		const isAnsweringQuestion = questionText !== undefined;
		const shouldShowConfirmation = (!isSessionAutoApproved && !isAnsweringQuestion) || context.forceConfirmationReason !== undefined;
		const confirmationMessages = shouldShowConfirmation ? {
			title: localize('send.confirm.title', "Send to Terminal"),
			message: confirmationMessage,
			allowAutoConfirm: undefined,
		} : undefined;

		return {
			invocationMessage,
			pastTenseMessage,
			confirmationMessages,
		};
	}

	private _getTerminalLabel(args: ISendToTerminalInputParams): string {
		if (args.id) {
			const execution = RunInTerminalTool.getExecution(args.id);
			if (execution) {
				return execution.instance.title;
			}
		}
		return args.id ?? '';
	}

	private _getTerminalInstanceId(args: ISendToTerminalInputParams): number | undefined {
		if (args.id) {
			const execution = RunInTerminalTool.getExecution(args.id);
			if (execution) {
				return execution.instance.instanceId;
			}
		}
		return undefined;
	}

	private _getQuestionContextForTerminal(chatSessionResource: URI | undefined, args: ISendToTerminalInputParams): string | undefined {
		if (!chatSessionResource) {
			return undefined;
		}

		const model = this._chatService.getSession(chatSessionResource);
		if (!model) {
			return undefined;
		}

		if (!args.id) {
			return undefined;
		}

		const commandText = args.command?.trim();

		const requests = model.getRequests();
		for (let i = requests.length - 1; i >= 0; i--) {
			const response = requests[i].response;
			if (!response) {
				continue;
			}
			const parts = response.response.value;

			let carouselIndex = -1;
			let carousel: IChatQuestionCarousel | undefined;
			for (let j = parts.length - 1; j >= 0; j--) {
				const part = parts[j];
				if (part.kind === 'questionCarousel') {
					const candidate = part as IChatQuestionCarousel;
					if (!candidate.terminalId || candidate.questions.length === 0) {
						continue;
					}
					if (candidate.terminalId === args.id) {
						carouselIndex = j;
						carousel = candidate;
						break;
					}
				}
			}

			if (!carousel || carouselIndex === -1) {
				continue;
			}

			let sendCount = 0;
			for (let j = carouselIndex + 1; j < parts.length; j++) {
				if (parts[j].kind === 'toolInvocation' && (parts[j] as { toolId?: string }).toolId === TerminalToolId.SendToTerminal) {
					sendCount++;
				}
			}

			const questionIndex = sendCount;
			if (questionIndex >= carousel.questions.length) {
				return undefined;
			}

			const question = carousel.questions[questionIndex];

			if (carousel.data) {
				const answer = carousel.data[question.id];
				if (this._answerMatchesCommand(answer, commandText)) {
					return this._getQuestionText(question);
				}
			}

			return undefined;
		}
		return undefined;
	}

	private _getQuestionText(question: IChatQuestionCarousel['questions'][0]): string {
		const text = question.message ?? question.title;
		return isMarkdownString(text) ? text.value : text;
	}

	private _answerMatchesCommand(answer: IChatQuestionAnswerValue | undefined, commandText: string): boolean {
		if (answer === undefined) {
			return commandText === '';
		}
		if (typeof answer === 'string') {
			return answer.trim() === commandText;
		}
		if (hasKey(answer, { selectedValues: true })) {
			const multi = answer as IChatMultiSelectAnswer;
			if (multi.selectedValues.some(v => v.trim() === commandText)) {
				return true;
			}
			if (multi.freeformValue?.trim() === commandText) {
				return true;
			}
			return commandText === '' && multi.selectedValues.length === 0 && !multi.freeformValue?.trim();
		}
		if (hasKey(answer, { selectedValue: true })) {
			const single = answer as IChatSingleSelectAnswer;
			if (single.selectedValue?.trim() === commandText || single.freeformValue?.trim() === commandText) {
				return true;
			}
			return commandText === '' && !single.selectedValue?.trim() && !single.freeformValue?.trim();
		}
		return false;
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, token: CancellationToken): Promise<IToolResult> {
		const args = invocation.parameters as ISendToTerminalInputParams;

		if (!args.id) {
			return {
				content: [{
					kind: 'text',
					value: `Error: 'id' (the active terminal execution UUID returned by ${TerminalToolId.RunInTerminal}) must be provided.`
				}]
			};
		}

		const execution = RunInTerminalTool.getExecution(args.id);
		if (!execution) {
			return {
				content: [{
					kind: 'text',
					value: `Error: No active terminal execution found with ID ${args.id}. The terminal may have already been killed or the ID is invalid. The ID must be the exact value returned by ${TerminalToolId.RunInTerminal}.`
				}]
			};
		}

		const startMarker = execution.instance.registerMarker?.();

		if (isMultilineCommand(args.command)) {
			await execution.instance.sendText(args.command, true, true);
		} else {
			await execution.instance.sendText(normalizeCommandForExecution(args.command), true);
		}

		let recentOutput: string;
		if (args.waitForOutput) {
			recentOutput = await this._waitForIdleOutput(execution, startMarker, token);
		} else {
			await timeout(2000, token);
			recentOutput = getOutput(execution.instance, startMarker ?? undefined, { lastNLines: 20 });
		}

		const steering = isCancelSignal(args.command)
			? `\n\nNote: The input you sent was a cancel signal (Ctrl-C / Ctrl-D / Ctrl-\\). The previously running command was interrupted, not completed. This is not a signal to end the turn — if you intend to run a recovery or follow-up command, issue it now in this same turn. Call ${TerminalToolId.GetTerminalOutput} first if you need to verify the shell is back at a prompt.`
			: '';

		return {
			content: [{
				kind: 'text',
				value: `Successfully sent command to terminal ${args.id}.${recentOutput ? `\n\nTerminal output:\n${recentOutput}` : ''}${steering}`
			}]
		};
	}

	private async _waitForIdleOutput(
		execution: ReturnType<typeof RunInTerminalTool.getExecution> & {},
		startMarker: ReturnType<ITerminalInstance['registerMarker']> | undefined,
		token: CancellationToken,
	): Promise<string> {
		const maxWaitMs = 30_000;
		const idleThresholdMs = 2_000;
		const pollIntervalMs = 500;
		let waited = 0;
		let lastDataTime = Date.now();

		const cts = new CancellationTokenSource(token);
		const dataListener = execution.instance.onData(() => {
			lastDataTime = Date.now();
		});

		try {
			while (!cts.token.isCancellationRequested && waited < maxWaitMs) {
				await timeout(pollIntervalMs, cts.token);
				waited += pollIntervalMs;

				const timeSinceLastData = Date.now() - lastDataTime;
				if (timeSinceLastData >= idleThresholdMs) {
					break;
				}
			}
		} finally {
			dataListener.dispose();
			cts.dispose();
		}

		return getOutput(execution.instance, startMarker ?? undefined);
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { encodeBase64 } from '../../../../../../base/common/buffer.js';
import { IMarkdownString } from '../../../../../../base/common/htmlContent.js';
import { IObservable, ISettableObservable, observableValue } from '../../../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { localize } from '../../../../../../nls.js';
import { ConfirmedReason, IChatAgentFeedbackReviewConfirmationData, IChatAutomationConfigurationData, IChatAutomationConfiguredData, IChatExtensionsContent, IChatGeneratedImageData, IChatModifiedFilesConfirmationData, IChatSearchToolInvocationData, IChatSessionCreatedData, IChatSimpleToolInvocationData, IChatSubagentToolInvocationData, IChatTodoListContent, IChatToolInputInvocationData, IChatToolInvocation, IChatToolInvocationOtherClientData, IChatToolInvocationSerialized, ToolConfirmKind, type IChatMcpAuthenticationRequiredServer, type IChatTerminalToolInvocationData } from '../../chatService/chatService.js';
import { IPreparedToolInvocation, isToolResultOutputDetails, IToolConfirmationMessages, IToolData, IToolProgressStep, IToolResult, ToolDataSource } from '../../tools/languageModelToolsService.js';

export interface IStreamingToolCallOptions {
	toolCallId: string;
	toolId: string;
	toolData: IToolData;
	subagentInvocationId?: string;
	chatRequestId?: string;
}

export class ChatToolInvocation implements IChatToolInvocation {
	public readonly kind: 'toolInvocation' = 'toolInvocation';

	public invocationMessage: string | IMarkdownString;
	public readonly originMessage: string | IMarkdownString | undefined;
	public pastTenseMessage: string | IMarkdownString | undefined;
	public confirmationMessages: IToolConfirmationMessages | undefined;
	public presentation: IPreparedToolInvocation['presentation'];
	public readonly toolId: string;
	public readonly icon?: ThemeIcon;
	public source: ToolDataSource;
	public readonly subAgentInvocationId: string | undefined;
	public parameters: unknown;
	public generatedTitle?: string;
	public readonly chatRequestId?: string;
	public isAttachedToThinking: boolean = false;
	public otherClientToolCall?: IChatToolInvocationOtherClientData;

	private _toolSpecificData?: IChatTerminalToolInvocationData | IChatToolInputInvocationData | IChatExtensionsContent | IChatTodoListContent | IChatSubagentToolInvocationData | IChatSimpleToolInvocationData | IChatSearchToolInvocationData | IChatModifiedFilesConfirmationData | IChatAgentFeedbackReviewConfirmationData | IChatSessionCreatedData | IChatGeneratedImageData | IChatAutomationConfigurationData | IChatAutomationConfiguredData;
	private readonly _toolSpecificDataKind = observableValue<string | undefined>(this, undefined);
	public readonly toolSpecificDataKind: IObservable<string | undefined> = this._toolSpecificDataKind;

	public get toolSpecificData() {
		return this._toolSpecificData;
	}

	public set toolSpecificData(value: typeof this._toolSpecificData) {
		this._toolSpecificData = value;
		this._toolSpecificDataKind.set(value?.kind, undefined);
	}

	private readonly _progress = observableValue<{ message?: string | IMarkdownString; progress: number | undefined }>(this, { progress: 0 });
	private readonly _state: ISettableObservable<IChatToolInvocation.State>;

	private readonly _partialInput = observableValue<unknown>(this, undefined);
	private readonly _streamingMessage = observableValue<string | IMarkdownString | undefined>(this, undefined);

	public get state(): IObservable<IChatToolInvocation.State> {
		return this._state;
	}

	public static createStreaming(options: IStreamingToolCallOptions): ChatToolInvocation {
		return new ChatToolInvocation(undefined, options.toolData, options.toolCallId, options.subagentInvocationId, undefined, { startInStreaming: true }, options.chatRequestId);
	}

	public static createCancelled(options: IStreamingToolCallOptions, parameters: unknown, reason: ToolConfirmKind.Denied | ToolConfirmKind.Skipped, reasonMessage?: string | IMarkdownString): ChatToolInvocation {
		return new ChatToolInvocation(undefined, options.toolData, options.toolCallId, options.subagentInvocationId, parameters, { startInCancelled: true, cancelReason: reason, cancelReasonMessage: reasonMessage }, options.chatRequestId);
	}

	constructor(
		preparedInvocation: IPreparedToolInvocation | undefined,
		toolData: IToolData,
		public readonly toolCallId: string,
		subAgentInvocationId: string | undefined,
		parameters: unknown,
		startOptions: { startInStreaming?: boolean; startInCancelled?: boolean; cancelReason?: ToolConfirmKind.Denied | ToolConfirmKind.Skipped; cancelReasonMessage?: string | IMarkdownString } = {},
		chatRequestId?: string
	) {
		let defaultMessage: string | IMarkdownString = '';
		if (startOptions.startInStreaming) {
			defaultMessage = toolData.displayName;
		} else if (startOptions.startInCancelled) {
			defaultMessage = startOptions.cancelReasonMessage ?? localize('toolDeniedMessage', "Tool \"{0}\" was denied", toolData.displayName);
		}
		this.invocationMessage = preparedInvocation?.invocationMessage ?? defaultMessage;
		this.pastTenseMessage = preparedInvocation?.pastTenseMessage;
		this.originMessage = preparedInvocation?.originMessage;
		this.confirmationMessages = preparedInvocation?.confirmationMessages;
		this.presentation = preparedInvocation?.presentation;
		this.toolSpecificData = preparedInvocation?.toolSpecificData;
		this.toolId = toolData.id;
		this.icon = preparedInvocation?.icon ?? (toolData.icon && ThemeIcon.isThemeIcon(toolData.icon) ? toolData.icon : undefined);
		this.source = toolData.source;
		this.subAgentInvocationId = subAgentInvocationId;
		this.parameters = parameters;
		this.chatRequestId = chatRequestId;

		if (startOptions.startInCancelled) {
			this._state = observableValue(this, {
				type: IChatToolInvocation.StateKind.Cancelled,
				reason: startOptions.cancelReason ?? ToolConfirmKind.Denied,
				reasonMessage: startOptions.cancelReasonMessage,
				parameters: this.parameters,
				confirmationMessages: this.confirmationMessages,
			});
		} else if (startOptions.startInStreaming) {
			this._state = observableValue(this, {
				type: IChatToolInvocation.StateKind.Streaming,
				partialInput: this._partialInput,
				streamingMessage: this._streamingMessage,
			});
		} else if (!this.confirmationMessages?.title) {
			this._state = observableValue(this, {
				type: IChatToolInvocation.StateKind.Executing,
				confirmed: { type: ToolConfirmKind.ConfirmationNotNeeded, reason: this.confirmationMessages?.confirmationNotNeededReason },
				progress: this._progress,
				parameters: this.parameters,
				confirmationMessages: this.confirmationMessages,
			});
		} else {
			this._state = observableValue(this, {
				type: IChatToolInvocation.StateKind.WaitingForConfirmation,
				parameters: this.parameters,
				confirmationMessages: this.confirmationMessages,
				confirm: reason => this._confirm(reason),
			});
		}
	}

	private _confirm(reason: ConfirmedReason): void {
		if (reason.type === ToolConfirmKind.Denied || reason.type === ToolConfirmKind.Skipped) {
			this._state.set({
				type: IChatToolInvocation.StateKind.Cancelled,
				reason: reason.type,
				parameters: this.parameters,
				confirmationMessages: this.confirmationMessages,
			}, undefined);
		} else {
			this._state.set({
				type: IChatToolInvocation.StateKind.Executing,
				confirmed: reason,
				progress: this._progress,
				parameters: this.parameters,
				confirmationMessages: this.confirmationMessages,
			}, undefined);
		}
	}

	public updatePartialInput(input: unknown): void {
		if (this._state.get().type !== IChatToolInvocation.StateKind.Streaming) {
			return;
		}
		this._partialInput.set(input, undefined);
	}

	public updateStreamingMessage(message: string | IMarkdownString): void {
		const state = this._state.get();
		if (state.type !== IChatToolInvocation.StateKind.Streaming) {
			return;
		}
		this._streamingMessage.set(message, undefined);
	}

	public notifyToolSpecificDataChanged(): void {
		const current = this._state.get();
		this._state.set({ ...current }, undefined);
	}

	public updateConfirmationMessages(confirmationMessages: IToolConfirmationMessages): void {
		const current = this._state.get();
		if (current.type !== IChatToolInvocation.StateKind.WaitingForConfirmation) {
			return;
		}
		this.confirmationMessages = confirmationMessages;
		this._state.set({ ...current, confirmationMessages }, undefined);
	}

	public cancelFromStreaming(reason: ToolConfirmKind.Denied | ToolConfirmKind.Skipped, reasonMessage?: string | IMarkdownString): boolean {
		const currentState = this._state.get();
		if (currentState.type !== IChatToolInvocation.StateKind.Streaming) {
			return false;
		}

		this._state.set({
			type: IChatToolInvocation.StateKind.Cancelled,
			reason: reason,
			reasonMessage: reasonMessage,
			parameters: this.parameters,
			confirmationMessages: this.confirmationMessages,
		}, undefined);
		return true;
	}

	public transitionFromStreaming(preparedInvocation: IPreparedToolInvocation | undefined, parameters: unknown, autoConfirmed: ConfirmedReason | undefined): void {
		const currentState = this._state.get();
		if (currentState.type !== IChatToolInvocation.StateKind.Streaming) {
			return;
		}

		const lastStreamingMessage = this._streamingMessage.get();
		if (lastStreamingMessage && !preparedInvocation?.invocationMessage) {
			this.invocationMessage = lastStreamingMessage;
		}

		this._updatePreparedInvocation(preparedInvocation, parameters);

		if (autoConfirmed) {
			this._confirm(autoConfirmed);
		} else if (!this.confirmationMessages?.title) {
			this._state.set({
				type: IChatToolInvocation.StateKind.Executing,
				confirmed: { type: ToolConfirmKind.ConfirmationNotNeeded, reason: this.confirmationMessages?.confirmationNotNeededReason },
				progress: this._progress,
				parameters: this.parameters,
				confirmationMessages: this.confirmationMessages,
			}, undefined);
		} else {
			this._state.set({
				type: IChatToolInvocation.StateKind.WaitingForConfirmation,
				parameters: this.parameters,
				confirmationMessages: this.confirmationMessages,
				confirm: reason => this._confirm(reason),
			}, undefined);
		}
	}

	public updatePreparedInvocation(preparedInvocation: IPreparedToolInvocation | undefined, parameters: unknown): boolean {
		const currentState = this._state.get();
		if (currentState.type === IChatToolInvocation.StateKind.Streaming
			|| currentState.type === IChatToolInvocation.StateKind.Completed
			|| currentState.type === IChatToolInvocation.StateKind.Cancelled) {
			return false;
		}

		this._updatePreparedInvocation(preparedInvocation, parameters);
		this._state.set({
			...currentState,
			parameters: this.parameters,
			confirmationMessages: this.confirmationMessages,
		}, undefined);
		return true;
	}

	private _updatePreparedInvocation(preparedInvocation: IPreparedToolInvocation | undefined, parameters: unknown): void {
		this.parameters = parameters;
		if (!preparedInvocation) {
			return;
		}
		if (preparedInvocation.invocationMessage) {
			this.invocationMessage = preparedInvocation.invocationMessage;
		}
		this.pastTenseMessage = preparedInvocation.pastTenseMessage;
		this.confirmationMessages = preparedInvocation.confirmationMessages;
		this.presentation = preparedInvocation.presentation;
		this.toolSpecificData = preparedInvocation.toolSpecificData;
	}

	public requestConfirmation(preparedInvocation: IPreparedToolInvocation): void {
		const currentType = this._state.get().type;
		if (currentType === IChatToolInvocation.StateKind.Streaming) {
			this.transitionFromStreaming(preparedInvocation, this.parameters, undefined);
			return;
		}
		if (currentType === IChatToolInvocation.StateKind.Completed
			|| currentType === IChatToolInvocation.StateKind.Cancelled
			|| currentType === IChatToolInvocation.StateKind.WaitingForConfirmation) {
			return;
		}

		if (preparedInvocation.invocationMessage) {
			this.invocationMessage = preparedInvocation.invocationMessage;
		}
		this.pastTenseMessage = preparedInvocation.pastTenseMessage;
		this.confirmationMessages = preparedInvocation.confirmationMessages;
		this.presentation = preparedInvocation.presentation;
		this.toolSpecificData = preparedInvocation.toolSpecificData;

		if (!this.confirmationMessages?.title) {
			return;
		}

		this._state.set({
			type: IChatToolInvocation.StateKind.WaitingForConfirmation,
			parameters: this.parameters,
			confirmationMessages: this.confirmationMessages,
			confirm: reason => this._confirm(reason),
		}, undefined);
	}

	private _setCompleted(result: IToolResult | undefined, postConfirmed?: ConfirmedReason | undefined) {
		if (postConfirmed && (postConfirmed.type === ToolConfirmKind.Denied || postConfirmed.type === ToolConfirmKind.Skipped)) {
			this._state.set({
				type: IChatToolInvocation.StateKind.Cancelled,
				reason: postConfirmed.type,
				parameters: this.parameters,
				confirmationMessages: this.confirmationMessages,
			}, undefined);
			return;
		}

		this._state.set({
			type: IChatToolInvocation.StateKind.Completed,
			confirmed: IChatToolInvocation.executionConfirmedOrDenied(this) || { type: ToolConfirmKind.ConfirmationNotNeeded },
			resultDetails: result?.toolResultDetails,
			postConfirmed,
			contentForModel: result?.content || [],
			parameters: this.parameters,
			confirmationMessages: this.confirmationMessages,
		}, undefined);
	}

	public async didExecuteTool(result: IToolResult | undefined, final?: boolean, checkIfResultAutoApproved?: () => Promise<ConfirmedReason | undefined>): Promise<IChatToolInvocation.State> {
		const currentState = this._state.get();
		if (currentState.type === IChatToolInvocation.StateKind.Completed || currentState.type === IChatToolInvocation.StateKind.Cancelled) {
			return currentState;
		}

		if (result?.toolSpecificData) {
			this.toolSpecificData = result.toolSpecificData;
		}
		if (result?.toolResultMessage) {
			this.pastTenseMessage = result.toolResultMessage;
		} else if (this._progress.get().message) {
			this.pastTenseMessage = this._progress.get().message;
		}

		if (this.confirmationMessages?.confirmResults && !result?.toolResultError && result?.confirmResults !== false && !final) {
			const autoApproved = await checkIfResultAutoApproved?.();
			if (autoApproved) {
				this._setCompleted(result, autoApproved);
			} else {
				this._state.set({
					type: IChatToolInvocation.StateKind.WaitingForPostApproval,
					confirmed: IChatToolInvocation.executionConfirmedOrDenied(this) || { type: ToolConfirmKind.ConfirmationNotNeeded },
					resultDetails: result?.toolResultDetails,
					contentForModel: result?.content || [],
					confirm: reason => this._setCompleted(result, reason),
					parameters: this.parameters,
					confirmationMessages: this.confirmationMessages,
				}, undefined);
			}
		} else {
			this._setCompleted(result);
		}

		return this._state.get();
	}

	public setAuthenticationRequired(server: IChatMcpAuthenticationRequiredServer, cancel: () => void = () => { }): void {
		const state = this._state.get();
		if (state.type !== IChatToolInvocation.StateKind.Executing && state.type !== IChatToolInvocation.StateKind.WaitingForAuthentication) {
			return;
		}
		this._state.set({
			type: IChatToolInvocation.StateKind.WaitingForAuthentication,
			server,
			cancel: state.type === IChatToolInvocation.StateKind.WaitingForAuthentication ? state.cancel : cancel,
			confirmed: state.confirmed,
			parameters: state.parameters,
			confirmationMessages: state.confirmationMessages,
		}, undefined);
	}

	public setAuthenticationResolved(): void {
		const state = this._state.get();
		if (state.type !== IChatToolInvocation.StateKind.WaitingForAuthentication) {
			return;
		}
		this._state.set({
			type: IChatToolInvocation.StateKind.Executing,
			confirmed: state.confirmed,
			progress: this._progress,
			parameters: state.parameters,
			confirmationMessages: state.confirmationMessages,
		}, undefined);
	}

	public acceptProgress(step: IToolProgressStep) {
		const prev = this._progress.get();
		this._progress.set({
			progress: step.progress || prev.progress || 0,
			message: step.message,
		}, undefined);
	}

	public toJSON(): IChatToolInvocationSerialized {
		const waitingForPostApproval = this.state.get().type === IChatToolInvocation.StateKind.WaitingForPostApproval;
		const details = waitingForPostApproval ? undefined : IChatToolInvocation.resultDetails(this);

		return {
			kind: 'toolInvocationSerialized',
			presentation: this.presentation,
			invocationMessage: this.invocationMessage,
			pastTenseMessage: this.pastTenseMessage,
			originMessage: this.originMessage,
			isConfirmed: waitingForPostApproval ? { type: ToolConfirmKind.Skipped } : IChatToolInvocation.executionConfirmedOrDenied(this),
			isComplete: true,
			source: this.source,
			resultDetails: isToolResultOutputDetails(details)
				? { output: { type: 'data', mimeType: details.output.mimeType, base64Data: encodeBase64(details.output.value) } }
				: details,
			toolSpecificData: this.toolSpecificData?.kind === 'automationConfiguration' ? undefined : this.toolSpecificData,
			toolCallId: this.toolCallId,
			toolId: this.toolId,
			subAgentInvocationId: this.subAgentInvocationId,
			generatedTitle: this.generatedTitle,
		};
	}
}

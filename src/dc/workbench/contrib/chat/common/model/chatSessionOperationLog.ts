/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { softAssertNever } from '../../../../../base/common/assert.js';
import { isMarkdownString } from '../../../../../base/common/htmlContent.js';
import { equals as objectsEqual } from '../../../../../base/common/objects.js';
import { isEqual as _urisEqual } from '../../../../../base/common/resources.js';
import { hasKey } from '../../../../../base/common/types.js';
import { URI, UriComponents } from '../../../../../base/common/uri.js';
import { IChatRequestVariableEntry } from '../attachments/chatVariableEntries.js';
import { serializeChatRequestOrigin } from '../chatRequestOrigin.js';
import { IChatMarkdownContent, IChatMcpAuthenticationRequired, IChatMcpServersStartingSlow, IChatVoiceProgressPart, ResponseModelState } from '../chatService/chatService.js';
import { ModifiedFileEntryState } from '../editing/chatEditingService.js';
import { IParsedChatRequest } from '../requestParser/chatParserTypes.js';
import { IChatAgentEditedFileEvent, IChatDataSerializerLog, IChatModel, IChatPendingRequest, IChatProgressResponseContent, IChatRequestModel, IChatRequestVariableData, ISerializableChatData, ISerializableChatModelInputState, ISerializableChatRequestData, ISerializablePendingRequestData, SerializedChatResponsePart, serializeSendOptions } from './chatModel.js';
import * as Adapt from './objectMutationLog.js';


const toJson = <T>(obj: T): T extends { toJSON?(): infer R } ? R : T => {
	const cast = obj as { toJSON?: () => T };
	// eslint-disable-next-line local/code-no-any-casts, @typescript-eslint/no-explicit-any
	return (cast && typeof cast.toJSON === 'function' ? cast.toJSON() : obj) as any;
};

type PersistedResponsePart = Exclude<IChatProgressResponseContent, IChatMcpAuthenticationRequired | IChatMcpServersStartingSlow | IChatVoiceProgressPart>;

const responsePartSchema = Adapt.v<PersistedResponsePart, SerializedChatResponsePart>(
	(obj): SerializedChatResponsePart => obj.kind === 'markdownContent' ? obj.content : toJson(obj),
	(a, b) => {
		if (isMarkdownString(a) && isMarkdownString(b)) {
			return a.value === b.value;
		}

		if (hasKey(a, { kind: true }) && hasKey(b, { kind: true })) {
			if (a.kind !== b.kind) {
				return false;
			}

			switch (a.kind) {
				case 'markdownContent':
					return a.content === (b as IChatMarkdownContent).content;

				case 'toolInvocationSerialized':
				case 'elicitationSerialized':
				case 'progressTaskSerialized':
				case 'textEditGroup':
				case 'multiDiffData':
				case 'mcpServersStarting':
				case 'thinking':
				case 'planReview':
				case 'autoModeResolution':
					return objectsEqual(a, b);

				case 'clearToPreviousToolInvocation':
				case 'codeblockUri':
				case 'command':
				case 'confirmation':
				case 'extensions':
				case 'hook':
				case 'inlineReference':
				case 'markdownVuln':
				case 'notebookEditGroup':
				case 'progressMessage':
				case 'systemNotification':
				case 'pullRequest':
				case 'questionCarousel':
				case 'undoStop':
				case 'warning':
				case 'info':
				case 'treeData':
				case 'workspaceEdit':
				case 'externalEdit':
				case 'disabledClaudeHooks':
					return a.kind === b.kind;

				default: {
					softAssertNever(a);

					return objectsEqual(a, b);
				}
			}
		}

		return false;
	}
);

const urisEqual = (a: UriComponents, b: UriComponents): boolean => {
	return _urisEqual(URI.from(a), URI.from(b));
};

const messageSchema = Adapt.object<IParsedChatRequest, IParsedChatRequest>({
	text: Adapt.v(m => m.text),
	parts: Adapt.v(m => m.parts, (a, b) => a.length === b.length && a.every((part, i) => part.text === b[i].text)),
});

const agentEditedFileEventSchema = Adapt.object<IChatAgentEditedFileEvent, IChatAgentEditedFileEvent>({
	uri: Adapt.v(e => e.uri, urisEqual),
	eventKind: Adapt.v(e => e.eventKind),
});

const chatVariableSchema = Adapt.object<IChatRequestVariableData, IChatRequestVariableData>({
	variables: Adapt.t(v => v.variables.map(IChatRequestVariableEntry.toExport), Adapt.array(Adapt.value((a, b) => a.name === b.name))),
});

const requestSchema = Adapt.object<IChatRequestModel, ISerializableChatRequestData>({
	requestId: Adapt.t(m => m.id, Adapt.key()),
	timestamp: Adapt.v(m => m.requestTimestamp),
	confirmation: Adapt.v(m => m.confirmation),
	message: Adapt.t(m => m.message, messageSchema),
	shouldBeRemovedOnSend: Adapt.v(m => m.shouldBeRemovedOnSend, objectsEqual),
	agent: Adapt.v(m => m.response?.agent, (a, b) => a?.id === b?.id),
	modelId: Adapt.v(m => m.modelId),
	editedFileEvents: Adapt.t(m => m.editedFileEvents, Adapt.array(agentEditedFileEventSchema)),
	variableData: Adapt.t(m => m.variableData, chatVariableSchema),
	isHidden: Adapt.v(() => undefined),
	hiddenFromTranscript: Adapt.v(m => m.isHiddenFromTranscript),
	requestHiddenFromTranscript: Adapt.v(m => m.isRequestHiddenFromTranscript && !m.isHiddenFromTranscript ? true : undefined),
	isCanceled: Adapt.v(() => undefined),

	response: Adapt.t(m => m.response?.entireResponse.value.filter((p): p is PersistedResponsePart => p.kind !== 'mcpAuthenticationRequired' && p.kind !== 'mcpServersStartingSlow' && p.kind !== 'voiceProgress'), Adapt.array(responsePartSchema)),
	responseId: Adapt.v(m => m.response?.id),
	responseTimestamp: Adapt.v(m => m.response?.timestamp),
	result: Adapt.v(m => m.response?.result, objectsEqual),
	responseMarkdownInfo: Adapt.v(
		m => m.response?.codeBlockInfos?.map(info => ({ suggestionId: info.suggestionId })),
		objectsEqual,
	),
	followups: Adapt.v(m => m.response?.followups, objectsEqual),
	modelState: Adapt.v(m => m.response?.stateT, objectsEqual),
	vote: Adapt.v(m => m.response?.vote),
	slashCommand: Adapt.t(m => m.response?.slashCommand, Adapt.value((a, b) => a?.name === b?.name)),
	usedContext: Adapt.v(m => m.response?.usedContext, objectsEqual),
	contentReferences: Adapt.v(m => m.response?.contentReferences, objectsEqual),
	codeCitations: Adapt.v(m => m.response?.codeCitations, objectsEqual),
	timeSpentWaiting: Adapt.v(m => m.response?.timestamp),
	completionTokens: Adapt.v(m => m.response?.completionTokenCount),
	promptTokens: Adapt.v(m => m.response?.usage?.promptTokens),
	outputBuffer: Adapt.v(m => m.response?.usage?.outputBuffer),
	promptTokenDetails: Adapt.v(m => m.response?.usage?.promptTokenDetails, objectsEqual),
	copilotCredits: Adapt.v(m => m.response?.usage?.copilotCredits),
	modelTotals: Adapt.v(m => m.response?.usage?.modelTotals, objectsEqual),
	sessionCopilotCredits: Adapt.v(m => m.response?.usage?.sessionCopilotCredits),
	elapsedMs: Adapt.v(m => m.response?.elapsedMs ?? (m.response?.completedAt ? Math.max(0, m.response.completedAt - m.response.confirmationAdjustedTimestamp.get()) : undefined)),
	modeInfo: Adapt.v(m => m.modeInfo, objectsEqual),
	isSystemInitiated: Adapt.v(m => m.isSystemInitiated),
	systemInitiatedLabel: Adapt.v(m => m.systemInitiatedLabel),
	terminalExecutionId: Adapt.v(m => m.terminalExecutionId),
	origin: Adapt.v(m => m.origin ? serializeChatRequestOrigin(m.origin) : undefined, objectsEqual),
}, {
	sealed: (o) => o.modelState?.value === ResponseModelState.Cancelled || o.modelState?.value === ResponseModelState.Failed || o.modelState?.value === ResponseModelState.Complete,
});

const inputStateSchema = Adapt.object<ISerializableChatModelInputState, ISerializableChatModelInputState>({
	attachments: Adapt.v(i => i.attachments.map(IChatRequestVariableEntry.toExport), objectsEqual),
	mode: Adapt.v(i => i.mode, (a, b) => a.id === b.id),
	selectedModel: Adapt.v(i => i.selectedModel, (a, b) => a?.identifier === b?.identifier && objectsEqual(a?.modelConfiguration, b?.modelConfiguration)),
	inputText: Adapt.v(i => i.inputText),
	selections: Adapt.v(i => i.selections, objectsEqual),
	permissionLevel: Adapt.v(i => i.permissionLevel),
	contrib: Adapt.v(i => i.contrib, objectsEqual),
});

const pendingRequestSchema = Adapt.object<IChatPendingRequest, ISerializablePendingRequestData>({
	id: Adapt.t(p => p.request.id, Adapt.key()),
	request: Adapt.t(p => p.request, requestSchema),
	kind: Adapt.v(p => p.kind),
	sendOptions: Adapt.v(p => serializeSendOptions(p.sendOptions), objectsEqual),
});

export const storageSchema = Adapt.object<IChatModel, ISerializableChatData>({
	version: Adapt.v(() => 3),
	creationDate: Adapt.v(m => m.timestamp),
	customTitle: Adapt.v(m => m.hasCustomTitle ? m.title : undefined),
	initialLocation: Adapt.v(m => m.initialLocation),
	inputState: Adapt.t(m => m.inputModel.toJSON(), inputStateSchema),
	responderUsername: Adapt.v(m => m.responderUsername),
	sessionId: Adapt.v(m => m.sessionId),
	requests: Adapt.t(m => m.getRequests(), Adapt.array(requestSchema)),
	hasPendingEdits: Adapt.v(m => m.editingSession?.entries.get().some(e => e.state.get() === ModifiedFileEntryState.Modified)),
	repoData: Adapt.v(m => m.repoData, objectsEqual),
	pendingRequests: Adapt.t(m => m.getPendingRequests(), Adapt.array(pendingRequestSchema)),
	workingDirectory: Adapt.v(m => m.workingDirectory?.toString()),
});

export class ChatSessionOperationLog extends Adapt.ObjectMutationLog<IChatModel, ISerializableChatData> implements IChatDataSerializerLog {
	constructor() {
		super(storageSchema, 1024);
	}
}

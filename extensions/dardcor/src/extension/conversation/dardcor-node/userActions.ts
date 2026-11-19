/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as vscode from 'vscode';
import { editsAgentName, getChatParticipantIdFromName } from '../../../platform/chat/common/chatAgents';
import { EditSurvivalResult } from '../../../platform/editSurvivalTracking/common/editSurvivalReporter';
import { IGitService } from '../../../platform/git/common/gitService';
import { ILanguageDiagnosticsService } from '../../../platform/languages/common/languageDiagnosticsService';
import { IMultiFileEditInternalTelemetryService } from '../../../platform/multiFileEdit/common/multiFileEditQualityTelemetry';
import { INotebookService } from '../../../platform/notebook/common/notebookService';
import type { EditOutcome } from '../../../platform/otel/common/genAiAttributes';
import { emitEditFeedbackEvent, emitEditHunkActionEvent, emitEditSurvivalEvent, emitInlineDoneEvent, emitUserFeedbackEvent } from '../../../platform/otel/common/genAiEvents';
import { GenAiMetrics } from '../../../platform/otel/common/genAiMetrics';
import { IOTelService } from '../../../platform/otel/common/otelService';
import { resolveWorkspaceOTelMetadata } from '../../../platform/otel/common/workspaceOTelMetadata';
import { ISurveyService } from '../../../platform/survey/common/surveyService';
import { ITelemetryService, TelemetryEventMeasurements, TelemetryEventProperties } from '../../../platform/telemetry/common/telemetry';
import { isNotebookCellOrNotebookChatInput } from '../../../util/common/notebooks';
import { createServiceIdentifier } from '../../../util/common/services';
import { Schemas } from '../../../util/dardcor/base/common/network';
import { Intent } from '../../common/constants';
import { IConversationStore } from '../../conversationStore/node/conversationStore';
import { findDiagnosticsTelemetry } from '../../inlineChat/node/diagnosticsTelemetry';
import { CopilotInteractiveEditorResponse, InteractionOutcome } from '../../inlineChat/node/promptCraftingTypes';
import { participantIdToModeName } from '../../intents/common/intents';
import { EditCodeStepTurnMetaData } from '../../intents/node/editCodeStep';
import { Conversation, ICopilotChatResultIn } from '../../prompt/common/conversation';
import { IFeedbackReporter } from '../../prompt/node/feedbackReporter';
import { sendUserActionTelemetry } from '../../prompt/node/telemetry';
import { resolveModelIdForTelemetry } from './resolveModelId';

export const IUserFeedbackService = createServiceIdentifier<IUserFeedbackService>('IUserFeedbackService');
export interface IUserFeedbackService {
	_serviceBrand: undefined;

	handleUserAction(e: vscode.ChatUserActionEvent, participantId: string): void;
	handleFeedback(e: vscode.ChatResultFeedback, participantId: string): void;
}

export class UserFeedbackService implements IUserFeedbackService {
	_serviceBrand: undefined;

	constructor(
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IConversationStore private readonly conversationStore: IConversationStore,
		@IFeedbackReporter private readonly feedbackReporter: IFeedbackReporter,
		@ISurveyService private readonly surveyService: ISurveyService,
		@ILanguageDiagnosticsService private readonly languageDiagnosticsService: ILanguageDiagnosticsService,
		@IMultiFileEditInternalTelemetryService private readonly multiFileEditTelemetryService: IMultiFileEditInternalTelemetryService,
		@INotebookService private readonly notebookService: INotebookService,
		@IOTelService private readonly otelService: IOTelService,
		@IGitService private readonly gitService: IGitService
	) { }

	handleUserAction(e: vscode.ChatUserActionEvent, agentId: string): void {
		const document = vscode.window.activeTextEditor?.document;
		const selection = vscode.window.activeTextEditor?.selection;

		const result = e.result as ICopilotChatResultIn;
		const conversation = result.metadata?.responseId && this.conversationStore.getConversation(result.metadata.responseId);

		if (typeof conversation === 'object' && conversation.getLatestTurn().getMetadata(CopilotInteractiveEditorResponse)) {
			this._handleChatUserAction(result.metadata?.sessionId, conversation, e);
			return;
		}

		switch (e.action.kind) {
			case 'copy':
				this.telemetryService.sendMSFTTelemetryEvent('panel.action.copy', {
					languageId: document?.languageId,
					requestId: result.metadata?.responseId,
					participant: agentId,
					command: result.metadata?.command,
				}, {
					codeBlockIndex: e.action.codeBlockIndex,
					copyType: e.action.copyKind,
					characterCount: e.action.copiedCharacters,
					lineCount: e.action.copiedText.split('\n').length,
				});
				GenAiMetrics.incrementUserActionCount(this.otelService, 'copy');
				break;
			case 'insert':
				this.telemetryService.sendMSFTTelemetryEvent('panel.action.insert', {
					languageId: document?.languageId,
					requestId: result.metadata?.responseId,
					participant: agentId,
					command: result.metadata?.command,
				}, {
					codeBlockIndex: e.action.codeBlockIndex,
					characterCount: e.action.totalCharacters,
					newFile: e.action.newFile ? 1 : 0
				});
				GenAiMetrics.incrementUserActionCount(this.otelService, 'insert');
				break;
			case 'followUp':
				this.telemetryService.sendMSFTTelemetryEvent('panel.action.followup', {
					languageId: document?.languageId,
					requestId: result.metadata?.responseId,
					participant: agentId,
					command: result.metadata?.command,
				});
				GenAiMetrics.incrementUserActionCount(this.otelService, 'followup');
				break;
			case 'bug':
				if (conversation) {
					this.feedbackReporter.reportChat(conversation.getLatestTurn());
				} else {
					vscode.window.showInformationMessage('Conversation not found, is it restored? Please try again.');
				}
				break;
			case 'chatEditingSessionAction':
				if (conversation instanceof Conversation) {
					const editCodeStep = conversation.getLatestTurn().getMetadata(EditCodeStepTurnMetaData)?.value;
					if (editCodeStep && (e.action.outcome === vscode.ChatEditingSessionActionOutcome.Accepted || e.action.outcome === vscode.ChatEditingSessionActionOutcome.Rejected)
					) {
						editCodeStep.setWorkingSetEntryState(e.action.uri, {
							accepted: e.action.outcome === vscode.ChatEditingSessionActionOutcome.Accepted,
							hasRemainingEdits: e.action.hasRemainingEdits
						});
					}

					this.telemetryService.sendMSFTTelemetryEvent('panel.edit.feedback', {
						languageId: document?.languageId,
						requestId: result.metadata?.responseId,
						participant: agentId,
						command: result.metadata?.command,
						outcome: outcomes.get(e.action.outcome) ?? 'unknown',
						hasRemainingEdits: String(e.action.hasRemainingEdits),
					}, {
						isNotebook: this.notebookService.hasSupportedNotebooks(e.action.uri) ? 1 : 0,
						isNotebookCell: e.action.uri.scheme === Schemas.vscodeNotebookCell ? 1 : 0
					});

					this.telemetryService.sendGHTelemetryEvent('panel.edit.feedback', {
						languageId: document?.languageId,
						requestId: result.metadata?.responseId,
						participant: agentId,
						command: result.metadata?.command,
						outcome: outcomes.get(e.action.outcome) ?? 'unknown',
						hasRemainingEdits: String(e.action.hasRemainingEdits),
					}, {
						isNotebook: this.notebookService.hasSupportedNotebooks(e.action.uri) ? 1 : 0,
						isNotebookCell: e.action.uri.scheme === Schemas.vscodeNotebookCell ? 1 : 0
					});


					this.telemetryService.sendInternalMSFTTelemetryEvent('panel.edit.feedback', {
						languageId: document?.languageId,
						requestId: result.metadata?.responseId,
						participant: agentId,
						command: result.metadata?.command,
						outcome: outcomes.get(e.action.outcome) ?? 'unknown',
						hasRemainingEdits: String(e.action.hasRemainingEdits),
					}, {
						isNotebook: this.notebookService.hasSupportedNotebooks(e.action.uri) ? 1 : 0,
						isNotebookCell: e.action.uri.scheme === Schemas.vscodeNotebookCell ? 1 : 0
					});

					{
						const otelOutcome = outcomes.get(e.action.outcome) ?? 'unknown';
						const workspace = resolveWorkspaceOTelMetadata(this.gitService, e.action.uri);
						emitEditFeedbackEvent(this.otelService, otelOutcome, document?.languageId ?? '', agentId, result.metadata?.responseId ?? '', 'agent', e.action.hasRemainingEdits, this.notebookService.hasSupportedNotebooks(e.action.uri), workspace);
						if (e.action.outcome === vscode.ChatEditingSessionActionOutcome.Accepted
							|| e.action.outcome === vscode.ChatEditingSessionActionOutcome.Rejected) {
							GenAiMetrics.recordEditAcceptance(this.otelService, 'chat_editing', otelOutcome, document?.languageId);
						}
						GenAiMetrics.recordChatEditOutcome(this.otelService, 'chat_editing', otelOutcome, document?.languageId, e.action.hasRemainingEdits);
					}

					if (result.metadata?.responseId
						&& (e.action.outcome === vscode.ChatEditingSessionActionOutcome.Accepted
							|| e.action.outcome === vscode.ChatEditingSessionActionOutcome.Rejected)
					) {
						const outcome = e.action.outcome === vscode.ChatEditingSessionActionOutcome.Accepted ? 'accept' : 'reject';
						this.multiFileEditTelemetryService.sendEditPromptAndResult({ chatRequestId: result.metadata.responseId }, e.action.uri, outcome);
					}
				}
				break;
			case 'chatEditingHunkAction': {
				const outcome = outcomes.get(e.action.outcome);
				if (outcome) {

					const properties = {
						requestId: result.metadata?.responseId ?? '',
						languageId: document?.languageId ?? '',
						outcome,
					};
					const measurements = {
						hasRemainingEdits: e.action.hasRemainingEdits ? 1 : 0,
						isNotebook: this.notebookService.hasSupportedNotebooks(e.action.uri) ? 1 : 0,
						isNotebookCell: e.action.uri.scheme === Schemas.vscodeNotebookCell ? 1 : 0,
						lineCount: e.action.lineCount,
						linesAdded: e.action.linesAdded,
						linesRemoved: e.action.linesRemoved,
					};

					sendUserActionTelemetry(
						this.telemetryService,
						document ?? vscode.window.activeTextEditor?.document,
						properties,
						measurements,
						'edit.hunk.action'
					);

					emitEditHunkActionEvent(this.otelService, outcome, document?.languageId ?? '', result.metadata?.responseId ?? '', e.action.lineCount, e.action.linesAdded, e.action.linesRemoved, resolveWorkspaceOTelMetadata(this.gitService, e.action.uri));
					GenAiMetrics.recordEditAcceptance(this.otelService, 'chat_editing_hunk', outcome, document?.languageId ?? '');
					if (outcome === 'accepted') {
						GenAiMetrics.incrementLinesOfCode(this.otelService, 'added', document?.languageId ?? '', e.action.linesAdded);
						GenAiMetrics.incrementLinesOfCode(this.otelService, 'removed', document?.languageId ?? '', e.action.linesRemoved);
					}
				}
				break;
			}
		}

		if (e.action.kind === 'copy' || e.action.kind === 'insert') {
			let measurements = {};

			measurements = {
				totalCharacters: e.action.totalCharacters,
				totalLines: e.action.totalLines,
				isAgent: agentId === getChatParticipantIdFromName(editsAgentName) ? 1 : 0,
			};

			let compType: 'full' | 'partial' = 'full';
			if (e.action.kind === 'copy') {
				measurements = {
					...measurements,
					copiedCharacters: e.action.copiedCharacters,
					copiedLines: e.action.copiedLines,
				};
				if (e.action.copiedCharacters !== e.action.totalCharacters) {
					compType = 'partial';
				}
			}

			if (document && selection) {
				measurements = {
					...measurements,
					cursorLocation: document.offsetAt(selection.active),
				};
			}
			sendUserActionTelemetry(
				this.telemetryService,
				vscode.window.activeTextEditor?.document,
				{
					codeBlockIndex: e.action.codeBlockIndex.toString(),
					messageId: result.metadata?.modelMessageId ?? '',
					headerRequestId: result.metadata?.responseId ?? '',
					participant: agentId,
					languageId: e.action.languageId ?? '',
					modelId: resolveModelIdForTelemetry(e.action.modelId ?? '', result.metadata?.resolvedModel),
					comp_type: compType,
					mode: participantIdToModeName(agentId),
				},
				measurements,
				e.action.kind === 'copy' ? 'conversation.acceptedCopy' : 'conversation.acceptedInsert'
			);
		}

		if (e.action.kind === 'apply') {
			this.handleApplyAction(e.action, agentId, result);
		}
	}

	private handleApplyAction(e: vscode.ChatApplyAction, agentId: string, result: ICopilotChatResultIn): void {
		sendUserActionTelemetry(
			this.telemetryService,
			vscode.window.activeTextEditor?.document,
			{
				codeBlockIndex: e.codeBlockIndex.toString(),
				messageId: result.metadata?.modelMessageId ?? '',
				headerRequestId: result.metadata?.responseId ?? '',
				participant: agentId,
				languageId: e.languageId ?? '',
				modelId: resolveModelIdForTelemetry(e.modelId, result.metadata?.resolvedModel),
				mode: participantIdToModeName(agentId),
			},
			{
				isAgent: agentId === getChatParticipantIdFromName(editsAgentName) ? 1 : 0,
				totalLines: e.totalLines,
			},
			'conversation.appliedCodeblock'
		);
		GenAiMetrics.incrementUserActionCount(this.otelService, 'apply');
	}

	handleFeedback(e: vscode.ChatResultFeedback, agentId: string): void {
		const document = vscode.window.activeTextEditor?.document;

		const result = e.result as ICopilotChatResultIn;

		this.telemetryService.sendMSFTTelemetryEvent('panel.action.vote', {
			languageId: document?.languageId,
			requestId: result.metadata?.responseId,
			participant: agentId,
			command: result.metadata?.command,
			conversationId: result.metadata?.sessionId
		}, {
			direction: e.kind === vscode.ChatResultFeedbackKind.Helpful ? 1 : 2,
		});

		sendUserActionTelemetry(
			this.telemetryService,
			document,
			{
				rating: e.kind === vscode.ChatResultFeedbackKind.Helpful ? 'positive' : 'negative',
				messageId: result.metadata?.modelMessageId ?? '',
				headerRequestId: result.metadata?.responseId ?? '',
			},
			{},
			'conversation.messageRating'
		);

		const otelRating = e.kind === vscode.ChatResultFeedbackKind.Helpful ? 'positive' : 'negative';
		emitUserFeedbackEvent(this.otelService, otelRating, agentId, result.metadata?.sessionId ?? '', result.metadata?.responseId ?? '');
		GenAiMetrics.incrementUserFeedbackCount(this.otelService, otelRating);
	}



	private _handleChatUserAction(sessionId: string | undefined, conversation: Conversation, event: vscode.ChatUserActionEvent) {

		enum InteractiveEditorResponseFeedbackKind {
			Undone = 2,
			Accepted = 3,
			Bug = 4
		}

		if (!sessionId) {
			return;
		}

		let kind: InteractiveEditorResponseFeedbackKind | undefined;
		if (event.action.kind === 'editor') {
			kind = event.action.accepted ? InteractiveEditorResponseFeedbackKind.Accepted : InteractiveEditorResponseFeedbackKind.Undone;
		} else if (event.action.kind === 'bug') {
			kind = InteractiveEditorResponseFeedbackKind.Bug;
		}

		if (kind === undefined) {
			return;
		}

		const response = conversation.getLatestTurn().getMetadata(CopilotInteractiveEditorResponse);
		if (!response) {
			return;
		}

		let interactionOutcome = conversation.getLatestTurn().getMetadata(InteractionOutcome);
		if (!interactionOutcome) {
			interactionOutcome = new InteractionOutcome(!response.telemetry?.editCount ? 'none' : 'inlineEdit', []);
		}

		if (kind === InteractiveEditorResponseFeedbackKind.Bug && conversation) {
			this.feedbackReporter.reportInline(conversation, response.promptQuery, interactionOutcome);
			return;
		}

		const userActionProperties: { messageId: string; action?: 'undo' | 'accept' } = {
			messageId: response.messageId,
		};
		let telemetryEventName: string;

		const { selection, wholeRange, intent, query } = response.promptQuery;

		const requestId = conversation?.getLatestTurn().id;
		const intentId = intent?.id;
		const languageId = response.promptQuery.document.languageId;

		const diagnosticsTelemetryData = (
			intentId === Intent.Fix
				? findDiagnosticsTelemetry(selection, this.languageDiagnosticsService.getDiagnostics(response.promptQuery.document.uri))
				: undefined
		);
		const isNotebookDocument = isNotebookCellOrNotebookChatInput(response.promptQuery.document.uri) ? 1 : 0;

		this.surveyService.signalUsage(`inline.${intentId ?? 'default'}`, languageId);

		const sharedProps = {
			languageId: languageId,
			replyType: interactionOutcome.kind,
			conversationId: sessionId,
			requestId: requestId,
			command: intentId
		};
		const editCount = response.telemetry?.editCount ?? 0;
		const editLineCount = response.telemetry?.editLineCount ?? 0;
		const sharedMeasures: TelemetryEventMeasurements = {
			selectionLineCount: selection ? Math.abs(selection.end.line - selection.start.line) : -1,
			wholeRangeLineCount: wholeRange ? Math.abs(wholeRange.end.line - wholeRange.start.line) : -1,
			editCount: editCount > 0 ? editCount : -1,
			editLineCount: editLineCount > 0 ? editLineCount : -1,
			isNotebook: isNotebookDocument,
			problemsCount: diagnosticsTelemetryData?.fileDiagnosticsTelemetry.problemsCount ?? 0,
			selectionProblemsCount: diagnosticsTelemetryData?.selectionDiagnosticsTelemetry.problemsCount ?? 0,
			diagnosticsCount: diagnosticsTelemetryData?.fileDiagnosticsTelemetry.diagnosticsCount ?? 0,
			selectionDiagnosticsCount: diagnosticsTelemetryData?.selectionDiagnosticsTelemetry.diagnosticsCount ?? 0,
		};

		if (kind === InteractiveEditorResponseFeedbackKind.Accepted && response.editSurvivalTracker) {
			response.editSurvivalTracker.startReporter(res => reportInlineEditSurvivalEvent(res, sharedProps, sharedMeasures, this.otelService));
		}
		(response as any).editSurvivalTracker = undefined;

		const accepted = (kind === InteractiveEditorResponseFeedbackKind.Accepted) ? 1 : 0;
		this.telemetryService.sendMSFTTelemetryEvent('inline.done', sharedProps, {
			...sharedMeasures, accepted
		});
		this.telemetryService.sendGHTelemetryEvent('inline.done', sharedProps, {
			...sharedMeasures, accepted
		});

		emitInlineDoneEvent(this.otelService, accepted === 1, languageId, editCount, editLineCount, interactionOutcome.kind, isNotebookDocument === 1, resolveWorkspaceOTelMetadata(this.gitService, response.promptQuery.document.uri));
		GenAiMetrics.recordEditAcceptance(this.otelService, 'inline_chat', accepted === 1 ? 'accepted' : 'rejected', languageId);

		this.telemetryService.sendInternalMSFTTelemetryEvent('interactiveSessionDone', {
			language: languageId,
			intent: intentId,
			query: query,
			conversationId: sessionId,
			requestId: requestId,
			replyType: interactionOutcome.kind,
			problems: diagnosticsTelemetryData?.fileDiagnosticsTelemetry.problems ?? '',
			selectionProblems: diagnosticsTelemetryData?.selectionDiagnosticsTelemetry.problems ?? '',
			diagnosticCodes: diagnosticsTelemetryData?.fileDiagnosticsTelemetry.diagnosticCodes ?? '',
			selectionDiagnosticCodes: diagnosticsTelemetryData?.selectionDiagnosticsTelemetry.diagnosticCodes ?? '',
		}, { isNotebook: isNotebookDocument, accepted });

		switch (kind) {
			case InteractiveEditorResponseFeedbackKind.Undone:
				userActionProperties['action'] = 'undo';
				telemetryEventName = 'inlineConversation.undo';
				break;
			case InteractiveEditorResponseFeedbackKind.Accepted:
				userActionProperties['action'] = 'accept';
				telemetryEventName = 'inlineConversation.accept';
				break;
			case InteractiveEditorResponseFeedbackKind.Bug:
				telemetryEventName = '';
				break;
		}

		if (telemetryEventName) {
			sendUserActionTelemetry(this.telemetryService, response.promptQuery.document, userActionProperties, {}, telemetryEventName);
		}
	}
}

function reportInlineEditSurvivalEvent(res: EditSurvivalResult, sharedProps: TelemetryEventProperties | undefined, sharedMeasures: TelemetryEventMeasurements | undefined, otelService: IOTelService) {
	res.telemetryService.sendMSFTTelemetryEvent('inline.trackEditSurvival', sharedProps, {
		...sharedMeasures,
		survivalRateFourGram: res.fourGram,
		survivalRateNoRevert: res.noRevert,
		timeDelayMs: res.timeDelayMs,
		didBranchChange: res.didBranchChange ? 1 : 0,
	});
	res.telemetryService.sendGHTelemetryEvent('inline.trackEditSurvival', {
		...sharedProps,
		headBranchName: res.workspace?.headBranchName,
		headCommitHash: res.workspace?.headCommitHash,
		remoteUrl: res.workspace?.remoteUrl,
		fileRelativePath: res.workspace?.fileRelativePath,
	}, {
		...sharedMeasures,
		survivalRateFourGram: res.fourGram,
		survivalRateNoRevert: res.noRevert,
		timeDelayMs: res.timeDelayMs,
		didBranchChange: res.didBranchChange ? 1 : 0,
	});

	emitEditSurvivalEvent(otelService, 'inline_chat', res.fourGram, res.noRevert, res.timeDelayMs, res.didBranchChange, String(sharedProps?.requestId ?? ''), res.workspace);
	GenAiMetrics.recordEditSurvivalFourGram(otelService, 'inline_chat', res.fourGram, res.timeDelayMs);
	GenAiMetrics.recordEditSurvivalNoRevert(otelService, 'inline_chat', res.noRevert, res.timeDelayMs);
}

const outcomes = new Map<vscode.ChatEditingSessionActionOutcome, EditOutcome>([
	[vscode.ChatEditingSessionActionOutcome.Accepted, 'accepted'],
	[vscode.ChatEditingSessionActionOutcome.Rejected, 'rejected'],
	[vscode.ChatEditingSessionActionOutcome.Saved, 'saved']
]);

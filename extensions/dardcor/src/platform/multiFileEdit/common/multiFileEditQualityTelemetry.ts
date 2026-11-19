/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { NotebookDocument, TextDocument, Uri } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import { ResourceMap } from '../../../util/dardcor/base/common/map';
import { IChatSessionService } from '../../chat/common/chatSessionService';
import { IGitService } from '../../git/common/gitService';
import { ILogService } from '../../log/common/logService';
import { IAlternativeNotebookContentService } from '../../notebook/common/alternativeContent';
import { INotebookService } from '../../notebook/common/notebookService';
import { resolveWorkspaceOTelMetadata } from '../../otel/common/workspaceOTelMetadata';
import { ITelemetryService, multiplexProperties } from '../../telemetry/common/telemetry';
import { IWorkspaceService } from '../../workspace/common/workspaceService';

export interface IMultiFileEdit {
	readonly isAgent?: boolean;
	readonly uri: Uri;
	readonly prompt: string;
	readonly document?: TextDocument | NotebookDocument;
}

export interface IMultiFileEditRequestInfo {
	readonly chatRequestId: string;
}

export interface IMultiFileEditTelemetry {
	readonly mapper: string;
	readonly chatSessionId?: string;
	readonly chatRequestId: string;
	readonly speculationRequestId: string;
}

export const IMultiFileEditInternalTelemetryService = createServiceIdentifier<IMultiFileEditInternalTelemetryService>('IMultiFileEditInternalTelemetryService');
export interface IMultiFileEditInternalTelemetryService {
	_serviceBrand: undefined;
	storeEditPrompt(edit: IMultiFileEdit, telemetryOptions: IMultiFileEditTelemetry): void;
	sendEditPromptAndResult(telemetry: IMultiFileEditRequestInfo, uri: Uri, outcome: 'accept' | 'reject'): Promise<void>;
}

export class MultiFileEditInternalTelemetryService extends Disposable implements IMultiFileEditInternalTelemetryService {

	declare _serviceBrand: undefined;

	private readonly editedFiles = new ResourceMap<Map<string, (IMultiFileEdit & IMultiFileEditTelemetry)[]>>();
	private readonly editedDocuments = new Map<string, ResourceMap<TextDocument | NotebookDocument>>();

	constructor(
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@INotebookService private readonly notebookService: INotebookService,
		@ILogService private readonly logService: ILogService,
		@IAlternativeNotebookContentService private readonly alternativeNotebookContent: IAlternativeNotebookContentService,
		@IChatSessionService private readonly chatSessionService: IChatSessionService,
		@IGitService private readonly gitService: IGitService,
	) {
		super();
		this._register(this.chatSessionService.onDidDisposeChatSession(sessionId => {
			this.editedDocuments.delete(sessionId);
		}));
	}

	storeEditPrompt(edit: IMultiFileEdit, telemetryOptions: IMultiFileEditTelemetry): void {
		this.logService.debug(`Storing edit prompt for ${edit.uri.toString()} with request ID ${telemetryOptions.chatRequestId}`);

		const existingEditsForUri = this.editedFiles.get(edit.uri) ?? new Map();
		const existingEditsForUriInRequest = existingEditsForUri.get(telemetryOptions.chatRequestId) ?? [];
		existingEditsForUriInRequest.push({ ...edit, ...telemetryOptions });
		existingEditsForUri.set(telemetryOptions.chatRequestId, existingEditsForUriInRequest);
		this.editedFiles.set(edit.uri, existingEditsForUri);
		if (edit.document && telemetryOptions.chatSessionId) {
			let sessionMap = this.editedDocuments.get(telemetryOptions.chatSessionId);
			if (!sessionMap) {
				sessionMap = new ResourceMap<TextDocument | NotebookDocument>();
				this.editedDocuments.set(telemetryOptions.chatSessionId, sessionMap);
			}
			sessionMap.set(edit.uri, edit.document);
		}
	}

	async sendEditPromptAndResult(telemetry: IMultiFileEditRequestInfo, uri: Uri, outcome: 'accept' | 'reject'): Promise<void> {
		const editsForUri = this.editedFiles.get(uri);
		if (!editsForUri) {
			return;
		}
		if (editsForUri.size > 1) {
			this.logService.debug(`Skipping telemetry for ${uri.toString()} with request ID ${telemetry.chatRequestId} due to multiple edit turns`);
			this.editedFiles.delete(uri);
			return;
		}

		const editsForUriInChatRequest = editsForUri.get(telemetry.chatRequestId);
		if (!editsForUriInChatRequest) {
			return;
		}

		if (editsForUriInChatRequest.length > 1) {
			this.logService.debug(`Skipping telemetry for ${uri.toString()} with request ID ${telemetry.chatRequestId} due to multiple edits in one turn`);
			this.editedFiles.delete(uri);
			return;
		}

		try {
			const edit = editsForUriInChatRequest[0];

			let languageId: string | undefined = undefined;
			let documentText: string | undefined = undefined;
			if (edit.chatSessionId) {
				const editedDocument = this.editedDocuments.get(edit.chatSessionId)?.get(uri);
				if (editedDocument && 'getText' in editedDocument) {
					languageId = editedDocument.languageId;
					documentText = editedDocument.getText();
				}
			}
			if (!documentText && !languageId) {
				if (this.notebookService.hasSupportedNotebooks(uri)) {
					const snapshot = await this.workspaceService.openNotebookDocumentAndSnapshot(uri, this.alternativeNotebookContent.getFormat(undefined));
					languageId ??= snapshot.languageId;
					documentText ??= snapshot.getText();
				}
				else {
					const textDocument = await this.workspaceService.openTextDocument(uri);
					languageId = textDocument.languageId;
					documentText = textDocument.getText();
				}
			}

			this.telemetryService.sendInternalMSFTTelemetryEvent('multiFileEditQuality',
				{
					requestId: telemetry.chatRequestId,
					speculationRequestId: edit.speculationRequestId,
					isAgent: String(edit.isAgent),
					outcome,
					prompt: edit.prompt,
					languageId,
					file: documentText,
					mapper: edit.mapper
				},
				{
					isNotebook: this.notebookService.hasSupportedNotebooks(uri) ? 1 : 0
				}
			);

			const workspace = resolveWorkspaceOTelMetadata(this.gitService, uri);
			void multiplexProperties({
				headerRequestId: edit.speculationRequestId,
				providerId: edit.mapper,
				languageId: languageId,
				messageText: edit.prompt,
				suggestion: outcome,
				completionTextJson: documentText,
				conversationId: edit.chatSessionId,
				messageId: edit.chatRequestId,
				headBranchName: workspace.headBranchName,
				headCommitHash: workspace.headCommitHash,
				remoteUrl: workspace.remoteUrl,
				fileRelativePath: workspace.fileRelativePath,
			}).then(gitHubEnhancedTelemetryProperties => this.telemetryService.sendEnhancedGHTelemetryEvent('fastApply/editOutcome', gitHubEnhancedTelemetryProperties)).catch(() => { });
			this.logService.debug(`Sent telemetry for ${uri.toString()} with request ID ${edit.chatRequestId}, SD request ID ${edit.speculationRequestId}, and outcome ${outcome}`);
		} catch (e) {
			this.logService.error('Error sending multi-file edit telemetry', JSON.stringify(e));
		} finally {
			this.editedFiles.delete(uri);
		}
	}
}

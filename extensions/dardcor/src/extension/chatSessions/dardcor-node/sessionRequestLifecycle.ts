/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { createServiceIdentifier } from '../../../util/common/services';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import { IChatSessionMetadataStore, StoredModeInstructions } from '../common/chatSessionMetadataStore';
import { IChatSessionWorkspaceFolderService } from '../common/chatSessionWorkspaceFolderService';
import { IChatSessionWorktreeCheckpointService } from '../common/chatSessionWorktreeCheckpointService';
import { IChatSessionWorktreeService } from '../common/chatSessionWorktreeService';
import { getWorkingDirectory, isIsolationEnabled, IWorkspaceInfo } from '../common/workspaceInfo';
import { IPullRequestDetectionService } from './pullRequestDetectionService';
import { clearChangesCacheForAffectedSessions } from './chatSessionChangesCache';

export interface ISessionRequestLifecycle {
	readonly _serviceBrand: undefined;

	startRequest(sessionId: string, request: vscode.ChatRequest, isFirstRequest: boolean, workspace: IWorkspaceInfo, agentName?: string): Promise<void>;

	endRequest(sessionId: string, request: vscode.ChatRequest, session: SessionCompletionInfo, token: vscode.CancellationToken): Promise<void>;
}

export interface SessionCompletionInfo {
	readonly status: vscode.ChatSessionStatus | undefined;
	readonly workspace: IWorkspaceInfo;
	readonly createdPullRequestUrl: string | undefined;
}

export const ISessionRequestLifecycle = createServiceIdentifier<ISessionRequestLifecycle>('ISessionRequestLifecycle');

export class SessionRequestLifecycle extends Disposable implements ISessionRequestLifecycle {
	declare readonly _serviceBrand: undefined;

	private readonly pendingRequestBySession = new Map<string, Set<vscode.ChatRequest>>();

	constructor(
		@IChatSessionWorktreeService private readonly worktreeService: IChatSessionWorktreeService,
		@IChatSessionWorktreeCheckpointService private readonly checkpointService: IChatSessionWorktreeCheckpointService,
		@IChatSessionWorkspaceFolderService private readonly workspaceFolderService: IChatSessionWorkspaceFolderService,
		@IPullRequestDetectionService private readonly prDetectionService: IPullRequestDetectionService,
		@IChatSessionMetadataStore private readonly metadataStore: IChatSessionMetadataStore,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async startRequest(sessionId: string, request: vscode.ChatRequest, isFirstRequest: boolean, workspace: IWorkspaceInfo, agentName?: string): Promise<void> {
		if (isFirstRequest) {
			if (workspace.worktreeProperties) {
				void this.worktreeService.setWorktreeProperties(sessionId, workspace.worktreeProperties);
			}
			const workingDirectory = getWorkingDirectory(workspace);
			if (workingDirectory && !isIsolationEnabled(workspace)) {
				void this.workspaceFolderService.trackSessionWorkspaceFolder(sessionId, workingDirectory.fsPath, workspace.repositoryProperties);
			}
		}

		const modeInstructions: StoredModeInstructions | undefined = request.modeInstructions2 ? {
			uri: request.modeInstructions2.uri?.toString(),
			name: request.modeInstructions2.name,
			content: request.modeInstructions2.content,
			metadata: request.modeInstructions2.metadata,
			isBuiltin: request.modeInstructions2.isBuiltin,
		} : undefined;
		this.metadataStore.updateRequestDetails(sessionId, [{ vscodeRequestId: request.id, agentId: agentName ?? '', modeInstructions }]).catch(ex => this.logService.error(ex, 'Failed to update request details'));

		const requests = this.pendingRequestBySession.get(sessionId) ?? new Set<vscode.ChatRequest>();
		requests.add(request);
		this.pendingRequestBySession.set(sessionId, requests);

		if (isFirstRequest) {
			await this.checkpointService.handleRequest(sessionId);
		}
	}

	async endRequest(sessionId: string, request: vscode.ChatRequest, session: SessionCompletionInfo, token: vscode.CancellationToken): Promise<void> {
		const pendingRequests = this.pendingRequestBySession.get(sessionId);
		if (pendingRequests && pendingRequests.size > 1) {
			pendingRequests.delete(request);
			return;
		}

		if (token.isCancellationRequested) {
			this.untrackRequest(sessionId, request);
			return;
		}

		try {
			if (session.status === vscode.ChatSessionStatus.Completed) {
				const workingDirectory = getWorkingDirectory(session.workspace);
				if (isIsolationEnabled(session.workspace)) {
					await this.worktreeService.handleRequestCompleted(sessionId);
				} else if (workingDirectory) {
					await this.workspaceFolderService.handleRequestCompleted(sessionId);
				}

				await this.checkpointService.handleRequestCompleted(sessionId, request.id);

				if (workingDirectory) {
					void clearChangesCacheForAffectedSessions(workingDirectory, [sessionId], this.logService, this.metadataStore, this.workspaceFolderService, this.worktreeService).catch(ex => this.logService.error(ex, 'Failed to clear changes cache after request completion'));
				}
			}

			this.prDetectionService.handlePullRequestCreated(sessionId, session.createdPullRequestUrl);
		} finally {
			this.untrackRequest(sessionId, request);
		}
	}

	private untrackRequest(sessionId: string, request: vscode.ChatRequest): void {
		const requests = this.pendingRequestBySession.get(sessionId);
		if (requests) {
			requests.delete(request);
			if (requests.size === 0) {
				this.pendingRequestBySession.delete(sessionId);
			}
		}
	}
}

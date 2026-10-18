/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { PermissionMode, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { Disposable, IReference } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../instantiation/common/instantiation.js';
import { ILogService } from '../../../log/common/log.js';
import { ISessionDatabase } from '../../common/sessionDataService.js';
import type { IAgentHostClientTelemetryContext } from '../../common/agentHostTelemetry.js';
import { FileEditTracker } from '../shared/fileEditTracker.js';
import type { ClaudeMapperState } from './claudeMapSessionEvents.js';
import { getClaudeToolPath, isClaudeFileEditTool } from './claudeToolDisplay.js';

export class ClaudeFileEditObserver extends Disposable {

	private readonly _editTracker: FileEditTracker;

	private readonly _editToolPaths = new Map<string, { readonly filePath: string; readonly toolName: string; readonly toolInput: unknown; readonly modelId: string | undefined; readonly clientContext?: IAgentHostClientTelemetryContext }>();

	constructor(
		sessionUri: string,
		dbRef: IReference<ISessionDatabase>,
		@ILogService private readonly _logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._register(dbRef);
		this._editTracker = instantiationService.createInstance(
			FileEditTracker,
			sessionUri,
			dbRef.object,
		);
	}

	observeAssistant(message: Extract<SDKMessage, { type: 'assistant' }>, mode?: PermissionMode, clientContext?: IAgentHostClientTelemetryContext): void {
		const content = message.message.content;
		if (!Array.isArray(content)) {
			return;
		}
		const modelId = typeof message.message.model === 'string' ? message.message.model : undefined;
		for (const block of content) {
			if (block.type !== 'tool_use' || !isClaudeFileEditTool(block.name)) {
				continue;
			}
			const filePath = getClaudeToolPath(block.name, block.input);
			if (!filePath) {
				continue;
			}
			this._editToolPaths.set(block.id, { filePath, toolName: block.name, toolInput: block.input, modelId, clientContext });
			void this._editTracker.trackEditStart(filePath, mode).catch(err =>
				this._logService.warn(`[ClaudeFileEditObserver] trackEditStart failed for ${filePath}: ${err}`));
		}
	}

	async observeUser(
		message: Extract<SDKMessage, { type: 'user' }>,
		turnId: string,
		mapperState: ClaudeMapperState,
	): Promise<void> {
		const content = message.message.content;
		if (!Array.isArray(content)) {
			return;
		}
		for (const block of content) {
			if (block.type !== 'tool_result') {
				continue;
			}
			const tracked = this._editToolPaths.get(block.tool_use_id);
			if (!tracked) {
				continue;
			}
			this._editToolPaths.delete(block.tool_use_id);
			try {
				await this._editTracker.completeEdit(tracked.filePath);
				const fileEdit = await this._editTracker.takeCompletedEdit(turnId, block.tool_use_id, tracked.filePath, tracked.toolName, tracked.toolInput, tracked.modelId, tracked.clientContext);
				if (fileEdit) {
					mapperState.cacheFileEdit(block.tool_use_id, fileEdit);
				}
			} catch (err) {
				this._logService.warn(`[ClaudeFileEditObserver] file edit tracking failed for ${tracked.filePath}: ${err}`);
			}
		}
	}

	override dispose(): void {
		void this._editTracker.flushAttribution().catch(error => {
			this._logService.warn(`[ClaudeFileEditObserver] Failed to flush edit attribution: ${error}`);
		});
		super.dispose();
	}
}

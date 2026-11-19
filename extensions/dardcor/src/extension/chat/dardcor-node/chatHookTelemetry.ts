/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { IPostToolUseHookResult, IPreToolUseHookResult } from '../../../platform/chat/common/chatHookService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';

export class ChatHookTelemetry {
	constructor(
		private readonly _telemetryService: ITelemetryService,
	) { }

	logConfiguredHooks(hooks: vscode.ChatRequestHooks): void {
		const hookTypeCounts: Record<string, number> = {};
		let totalHookCount = 0;
		for (const hookType of Object.keys(hooks)) {
			const commands = hooks[hookType];
			if (commands && commands.length > 0) {
				hookTypeCounts[hookType] = commands.length;
				totalHookCount += commands.length;
			}
		}

		if (totalHookCount === 0) {
			return;
		}

		this._telemetryService.sendMSFTTelemetryEvent('hooks.configured', {
			hookTypes: JSON.stringify(hookTypeCounts),
		}, {
			totalHookCount,
		});
	}

	logHookExecuted(hookType: string, hookCount: number, durationMs: number, hasError: boolean, hasCaughtException: boolean): void {
		this._telemetryService.sendMSFTTelemetryEvent('hooks.executed', {
			hookType,
			hasError: String(hasError),
			hasCaughtException: String(hasCaughtException),
		}, {
			hookCount,
			durationMs,
		});
	}

	logPreToolUseResult(result: IPreToolUseHookResult): void {
		this._telemetryService.sendMSFTTelemetryEvent('hooks.preToolUse.result', {
			permissionDecision: result.permissionDecision,
			hasUpdatedInput: result.updatedInput ? 'true' : undefined,
			hasAdditionalContext: result.additionalContext ? 'true' : undefined,
		});
	}

	logPostToolUseResult(result: IPostToolUseHookResult): void {
		this._telemetryService.sendMSFTTelemetryEvent('hooks.postToolUse.result', {
			didBlock: result.decision === 'block' ? 'true' : undefined,
			hasAdditionalContext: result.additionalContext ? 'true' : undefined,
		});
	}
}

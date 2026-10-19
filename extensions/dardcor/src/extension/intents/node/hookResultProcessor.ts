/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type { ChatResponseStream } from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { ChatHookType } from '../../../dardcorTypes';

export class HookAbortError extends Error {
	constructor(
		public readonly hookType: string,
		public readonly stopReason: string
	) {
		super(`Hook ${hookType} aborted: ${stopReason}`);
		this.name = 'HookAbortError';
	}
}

export function isHookAbortError(error: unknown): error is HookAbortError {
	return error instanceof HookAbortError;
}

export interface HookResult {
	stopReason?: string;
	resultKind: 'success' | 'error' | 'warning';
	warningMessage?: string;
	output: unknown;
}

export interface ProcessHookResultsOptions {
	hookType: ChatHookType;
	results: readonly HookResult[];
	outputStream: ChatResponseStream | undefined;
	logService: ILogService;
	onSuccess: (output: unknown) => void;
	ignoreErrors?: boolean;
	onError?: (errorMessage: string) => void;
}

export function processHookResults(options: ProcessHookResultsOptions): void {
	const { hookType, results, outputStream, logService, onSuccess, ignoreErrors, onError } = options;

	const warnings: string[] = [];

	for (const result of results) {
		if (result.stopReason !== undefined) {
			if (ignoreErrors) {
				logService.trace(`[ToolCallingLoop] ${hookType} hook stopReason ignored: ${result.stopReason}`);
				continue;
			}
			logService.info(`[ToolCallingLoop] ${hookType} hook requested abort: ${result.stopReason}`);
			outputStream?.hookProgress(hookType, formatHookErrorMessage(result.stopReason));
			throw new HookAbortError(hookType, result.stopReason);
		}

		if (result.resultKind === 'warning' && result.warningMessage) {
			logService.trace(`[ToolCallingLoop] ${hookType} hook warning: ${result.warningMessage}`);
			warnings.push(result.warningMessage);
		}

		if (result.resultKind === 'success') {
			if (result.warningMessage) {
				warnings.push(result.warningMessage);
			}
			onSuccess(result.output);
		}

		if (result.resultKind === 'error') {
			const errorMessage = typeof result.output === 'string' && result.output ? result.output : '';
			logService.error(new Error(errorMessage), `[ToolCallingLoop] ${hookType} hook error`);
			if (onError) {
				onError(errorMessage);
				continue;
			} else if (ignoreErrors) {
				continue;
			} else {
				outputStream?.hookProgress(hookType, formatHookErrorMessage(errorMessage));
				throw new HookAbortError(hookType, errorMessage);
			}
		}
	}

	if (warnings.length > 0 && outputStream) {
		if (warnings.length === 1) {
			outputStream.hookProgress(hookType, undefined, warnings[0]);
		} else {
			const formattedWarnings = warnings.map((w, i) => `${i + 1}. ${w}`).join('\n');
			outputStream.hookProgress(hookType, undefined, formattedWarnings);
		}
	}
}

export function formatHookErrorMessage(errorMessage: string): string {
	if (errorMessage) {
		return l10n.t('A hook prevented chat from continuing. Please check the Dardcor Chat Hooks output channel for more details. \nError message: {0}', errorMessage);
	}
	return l10n.t('A hook prevented chat from continuing. Please check the Dardcor Chat Hooks output channel for more details.');
}

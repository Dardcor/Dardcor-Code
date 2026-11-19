/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

import { ExecConfig, TypeScriptRequests } from '../typescriptService';
import TypeScriptServiceClientHost from '../typeScriptServiceClientHost';
import { nulToken } from '../utils/cancellation';
import { Lazy } from '../utils/lazy';
import { Command } from './commandManager';

function isCancellationToken(value: any): value is vscode.CancellationToken {
	return value && typeof value.isCancellationRequested === 'boolean' && typeof value.onCancellationRequested === 'function';
}

export interface RequestArgs {
	readonly file?: unknown;
	readonly $traceId?: unknown;
}

export class TSServerRequestCommand implements Command {
	public readonly id = 'typescript.tsserverRequest';

	public constructor(
		private readonly lazyClientHost: Lazy<TypeScriptServiceClientHost>
	) { }

	public async execute(command: keyof TypeScriptRequests, args?: unknown, config?: ExecConfig, token?: vscode.CancellationToken): Promise<unknown> {
		if (!isCancellationToken(token)) {
			token = nulToken;
		}
		if (args && typeof args === 'object' && !Array.isArray(args)) {
			const requestArgs = args as RequestArgs;
			const hasFile = requestArgs.file instanceof vscode.Uri;
			const hasTraceId = typeof requestArgs.$traceId === 'string';
			if (hasFile || hasTraceId) {
				const newArgs = { file: undefined as string | undefined, ...args };
				if (hasFile) {
					const client = this.lazyClientHost.value.serviceClient;
					newArgs.file = client.toOpenTsFilePath(requestArgs.file);
				}
				if (hasTraceId) {
					const telemetryReporter = this.lazyClientHost.value.serviceClient.telemetryReporter;
					telemetryReporter.logTraceEvent('TSServerRequestCommand.execute', requestArgs.$traceId, JSON.stringify({ command }));
				}
				args = newArgs;
			}
		}

		const allowList = [
			'emit-output',
			'semanticDiagnosticsSync',
			'syntacticDiagnosticsSync',
			'suggestionDiagnosticsSync',
			'quickinfo',
			'quickinfo-full',
			'completionInfo'
		];

		if (allowList.includes(command) || command.startsWith('_')) {
			return this.lazyClientHost.value.serviceClient.execute(command, args, token, config);
		}
		return undefined;
	}
}

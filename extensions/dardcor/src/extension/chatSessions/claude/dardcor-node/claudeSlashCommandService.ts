/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../../platform/log/common/logService';
import { CancellationToken } from '../../../../util/dardcor/base/common/cancellation';
import { Disposable } from '../../../../util/dardcor/base/common/lifecycle';
import { createDecorator, IInstantiationService } from '../../../../util/dardcor/platform/instantiation/common/instantiation';
import { getClaudeSlashCommandRegistry, IClaudeSlashCommandHandler } from './slashCommands/claudeSlashCommandRegistry';

export interface IClaudeSlashCommandRequest {
	readonly prompt: string;
	readonly command: string | undefined;
}

import './slashCommands/index';

export interface IClaudeSlashCommandResult {
	handled: boolean;
	result?: vscode.ChatResult;
}

export interface IClaudeSlashCommandService {
	readonly _serviceBrand: undefined;

	tryHandleCommand(
		request: IClaudeSlashCommandRequest,
		stream: vscode.ChatResponseStream,
		token: CancellationToken
	): Promise<IClaudeSlashCommandResult>;

	getRegisteredCommands(): readonly string[];
}

export const IClaudeSlashCommandService = createDecorator<IClaudeSlashCommandService>('claudeSlashCommandService');

export class ClaudeSlashCommandService extends Disposable implements IClaudeSlashCommandService {
	readonly _serviceBrand: undefined;

	private _handlerCache = new Map<string, IClaudeSlashCommandHandler>();
	private _initialized = false;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._ensureInitialized();
	}

	async tryHandleCommand(
		request: IClaudeSlashCommandRequest,
		stream: vscode.ChatResponseStream,
		token: CancellationToken
	): Promise<IClaudeSlashCommandResult> {
		if (request.command) {
			const handler = this._getHandler(request.command.toLowerCase());
			if (handler) {
				const result = await handler.handle(request.prompt, stream, token);
				return { handled: true, result: result ?? {} };
			}
		}

		const match = request.prompt.trim().match(/^\/(\w+)(?:\s+(.*))?$/);
		if (!match) {
			return { handled: false };
		}

		const [, commandName, args] = match;
		const handler = this._getHandler(commandName.toLowerCase());
		if (!handler) {
			return { handled: false };
		}

		const result = await handler.handle(args ?? '', stream, token);
		return { handled: true, result: result ?? {} };
	}

	getRegisteredCommands(): readonly string[] {
		this._ensureInitialized();
		return Array.from(this._handlerCache.keys());
	}

	private _getHandler(commandName: string): IClaudeSlashCommandHandler | undefined {
		this._ensureInitialized();
		return this._handlerCache.get(commandName);
	}

	private _ensureInitialized(): void {
		if (this._initialized) {
			return;
		}

		const ctors = getClaudeSlashCommandRegistry();
		for (const ctor of ctors) {
			const handler = this.instantiationService.createInstance(ctor);
			const commandKey = handler.commandName.toLowerCase();
			if (this._handlerCache.has(commandKey)) {
				this.logService.warn(`Duplicate Claude slash command name "${handler.commandName}" detected. Ignoring handler ${ctor.name || 'unknown constructor'}.`);
				continue;
			}
			this._handlerCache.set(commandKey, handler);

			if (handler.commandId) {
				this._register(vscode.commands.registerCommand(handler.commandId, () => {
					return handler.handle('', undefined, CancellationToken.None);
				}));
			}
		}

		this._initialized = true;
	}
}

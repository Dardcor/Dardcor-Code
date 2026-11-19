/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CancellationToken } from 'vscode';

export interface IClaudeSlashCommandHandler {
	readonly commandName: string;

	readonly description: string;

	readonly commandId?: string;

	handle(
		args: string,
		stream: vscode.ChatResponseStream | undefined,
		token: CancellationToken
	): Promise<vscode.ChatResult | void>;
}

export interface IClaudeSlashCommandHandlerCtor {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	new(...args: any[]): IClaudeSlashCommandHandler;
}

const handlerRegistry: IClaudeSlashCommandHandlerCtor[] = [];

export function registerClaudeSlashCommand(ctor: IClaudeSlashCommandHandlerCtor): void {
	handlerRegistry.push(ctor);
}

export function getClaudeSlashCommandRegistry(): readonly IClaudeSlashCommandHandlerCtor[] {
	return handlerRegistry;
}

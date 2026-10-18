/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, ChatHookCommand } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';

export const IHookExecutor = createServiceIdentifier<IHookExecutor>('IHookExecutor');

export const enum HookCommandResultKind {
	Success = 1,
	Error = 2,
	NonBlockingError = 3
}

export interface IHookCommandResult {
	readonly kind: HookCommandResultKind;
	readonly result: string | object;
	readonly exitCode?: number;
}

export interface IHookExecutor {
	readonly _serviceBrand: undefined;

	executeCommand(
		hookCommand: ChatHookCommand,
		input: unknown,
		token: CancellationToken
	): Promise<IHookCommandResult>;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands, Disposable } from 'vscode';
import { IDisposable } from '../../../../../util/dardcor/base/common/lifecycle';
import { IInstantiationService, type ServicesAccessor } from '../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { handleException } from '../../lib/src/defaultHandlers';
import { Logger } from '../../lib/src/logger';

function exception(accessor: ServicesAccessor, error: unknown, origin: string, logger?: Logger) {
	if (error instanceof Error && error.name === 'Canceled') {
		return;
	}
	if (error instanceof Error && error.name === 'CodeExpectedError') {
		return;
	}
	handleException(accessor, error, origin, logger);
}

export function registerCommand(accessor: ServicesAccessor, command: string, fn: (...args: unknown[]) => unknown): Disposable {
	const instantiationService = accessor.get(IInstantiationService);
	try {
		const disposable = commands.registerCommand(command, async (...args: unknown[]) => {
			try {
				await fn(...args);
			} catch (error) {
				instantiationService.invokeFunction(exception, error, command);
			}
		});
		return disposable;
	} catch (error) {
		console.error(`Error registering command ${command}:`, error);
		throw error;
	}
}

export function registerCommandWrapper(accessor: ServicesAccessor, command: string, fn: (...args: unknown[]) => unknown): IDisposable {
	return registerCommand(accessor, command, fn);
}

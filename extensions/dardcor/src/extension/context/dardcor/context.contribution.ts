/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, commands } from 'vscode';
import { DisposableStore, IDisposable } from '../../../util/dardcor/base/common/lifecycle';
import { ServicesAccessor } from '../../../util/dardcor/platform/instantiation/common/instantiation';

export function create(accessor: ServicesAccessor): IDisposable {
	const disposables = new DisposableStore();
	disposables.add(registerContextCommands(accessor));

	return disposables;
}


function registerContextCommands(accessor: ServicesAccessor) {
	return Disposable.from(
		commands.registerCommand('github.dardcor.chat.attachFile', () => {
			return commands.executeCommand('workbench.action.chat.attachFile');
		}),
		commands.registerCommand('github.dardcor.chat.attachSelection', () => {
			return commands.executeCommand('workbench.action.chat.attachSelection');
		}),
	);
}

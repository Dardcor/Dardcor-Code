/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionContext } from 'vscode';
import { baseActivate } from '../dardcor/extension';
import { vscodeWebContributions } from './contributions';
import { registerServices } from './services';


export function activate(context: ExtensionContext, forceActivation?: boolean) {
	return baseActivate({
		context,
		registerServices,
		contributions: vscodeWebContributions,
		forceActivation
	});
}

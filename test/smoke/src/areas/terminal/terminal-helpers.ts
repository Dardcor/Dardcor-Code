/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../../../automation';

export async function setTerminalTestSettings(app: Application, additionalSettings: [key: string, value: string][] = []) {
	await app.workbench.settingsEditor.addUserSettings([
		['editor.wordWrap', '"on"'],
		['terminal.integrated.tabs.hideCondition', '"never"'],
		['terminal.integrated.gpuAcceleration', '"off"'],
		...additionalSettings
	]);

	await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
}

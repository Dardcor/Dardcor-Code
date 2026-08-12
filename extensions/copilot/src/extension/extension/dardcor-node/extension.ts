/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Must be the first import to ensure it evaluates before other imports.
import './disableProcessReport';

import { ExtensionContext } from 'vscode';
import { spawn } from 'child_process';
import { resolve } from '../../../util/dardcor/base/common/path';
import { baseActivate } from '../dardcor/extension';
import { vscodeNodeContributions } from './contributions';
import { registerServices } from './services';

// ###############################################################################################
// ###                                                                                         ###
// ###                 Node extension that runs ONLY in node.js extension host.                ###
// ###                                                                                         ###
// ### !!! Prefer to add code in ../vscode/extension.ts to support all extension runtimes !!!  ###
// ###                                                                                         ###
// ###############################################################################################

//#region TODO@bpasero this needs cleanup
import '../../intents/node/allIntents';

function configureDevPackages() {
	try {
		const sourceMapSupport = require('source-map-support');
		sourceMapSupport.install();
		const dotenv = require('dotenv');
		dotenv.config({ path: [resolve(__dirname, '../.env')] });
	} catch (err) {
		console.error(err);
	}
}
//#endregion

export function activate(context: ExtensionContext, forceActivation?: boolean) {
	// Auto-start Dardcor Provider in background
	try {
		const providerPath = resolve(context.extensionPath, '../../.dardcor-provider');
		// Spawn the provider process (using npm start)
		const child = spawn(/^win/.test(process.platform) ? 'npm.cmd' : 'npm', ['start'], {
			cwd: providerPath,
			detached: true,
			stdio: 'ignore'
		});
		child.unref(); // Allow the parent (VS Code) to exit independently
	} catch (err) {
		console.error('Failed to start Dardcor Provider:', err);
	}

	return baseActivate({
		context,
		registerServices,
		contributions: vscodeNodeContributions,
		configureDevPackages,
		forceActivation
	});
}

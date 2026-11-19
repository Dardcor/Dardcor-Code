/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './disableProcessReport';

import { ExtensionContext } from 'vscode';
import { resolve } from '../../../util/dardcor/base/common/path';
import { baseActivate } from '../dardcor/extension';
import { vscodeNodeContributions } from './contributions';
import { registerServices } from './services';


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

export function activate(context: ExtensionContext, forceActivation?: boolean) {
	return baseActivate({
		context,
		registerServices,
		contributions: vscodeNodeContributions,
		configureDevPackages,
		forceActivation
	});
}

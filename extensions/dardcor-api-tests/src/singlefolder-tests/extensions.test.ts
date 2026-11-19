/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import 'mocha';
import * as vscode from 'vscode';

suite('vscode server cli', () => {


	test('extension is installed and enabled when installed by server cli', function () {
		const extension = process.env.TESTRESOLVER_INSTALL_BUILTIN_EXTENSION;
		if (!process.env.BUILD_SOURCEVERSION
			|| process.env.VSCODE_QUALITY === 'oss'
			|| !process.env.REMOTE_VSCODE
			|| !extension
		) {
			this.skip();
		}

		assert.ok(vscode.extensions.getExtension(extension!));
	});

});

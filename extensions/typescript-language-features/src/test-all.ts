/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


const testRunner = require('../../../test/integration/electron/testrunner');

testRunner.configure({
	ui: 'tdd',
	color: true,
	timeout: 60000,
});

export = testRunner;

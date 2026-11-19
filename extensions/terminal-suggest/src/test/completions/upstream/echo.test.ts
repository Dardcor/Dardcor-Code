/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import { testPaths, type ISuiteSpec } from '../../helpers';
import echoSpec from '../../../completions/upstream/echo';

const allOptions = [
	'-E',
	'-e',
	'-n',
];
const echoExpectedCompletions = [{ label: 'echo', description: (echoSpec as Fig.Subcommand).description }];
export const echoTestSuiteSpec: ISuiteSpec = {
	name: 'echo',
	completionSpecs: echoSpec,
	availableCommands: 'echo',
	testSpecs: [
		{ input: '|', expectedCompletions: echoExpectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },

		{ input: 'e|', expectedCompletions: echoExpectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },
		{ input: 'ec|', expectedCompletions: echoExpectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },
		{ input: 'ech|', expectedCompletions: echoExpectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },
		{ input: 'echo|', expectedCompletions: echoExpectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },

		{ input: 'echo |', expectedCompletions: allOptions },

	]
};

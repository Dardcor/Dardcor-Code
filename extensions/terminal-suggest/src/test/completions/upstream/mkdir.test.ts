/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import { testPaths, type ISuiteSpec } from '../../helpers';
import mkdirSpec from '../../../completions/upstream/mkdir';

const allOptions = [
	'--context <context>',
	'--help',
	'--mode <mode>',
	'--parents',
	'--verbose',
	'--version',
	'-Z <context>',
	'-m <mode>',
	'-p',
	'-v',
];
const expectedCompletions = [{ label: 'mkdir', description: (mkdirSpec as Fig.Subcommand).description }];
export const mkdirTestSuiteSpec: ISuiteSpec = {
	name: 'mkdir',
	completionSpecs: mkdirSpec,
	availableCommands: 'mkdir',
	testSpecs: [
		{ input: '|', expectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },

		{ input: 'm|', expectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },
		{ input: 'mkdir|', expectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },

		{ input: 'mkdir |', expectedCompletions: allOptions, expectedResourceRequests: { type: 'folders', cwd: testPaths.cwd } },

	]
};

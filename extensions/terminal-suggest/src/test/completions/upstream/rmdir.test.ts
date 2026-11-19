/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import { testPaths, type ISuiteSpec } from '../../helpers';
import rmdirSpec from '../../../completions/upstream/rmdir';

const allOptions = [
	'-p',
];
const expectedCompletions = [{ label: 'rmdir', description: (rmdirSpec as Fig.Subcommand).description }];

export const rmdirTestSuiteSpec: ISuiteSpec = {
	name: 'rmdir',
	completionSpecs: rmdirSpec,
	availableCommands: 'rmdir',
	testSpecs: [
		{ input: '|', expectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },

		{ input: 'r|', expectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },
		{ input: 'rmdir|', expectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },

		{ input: 'rmdir |', expectedCompletions: allOptions, expectedResourceRequests: { type: 'folders', cwd: testPaths.cwd } },
	]
};

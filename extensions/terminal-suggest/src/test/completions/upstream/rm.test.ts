/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import { testPaths, type ISuiteSpec } from '../../helpers';
import rmSpec from '../../../completions/upstream/rm';

const allOptions = [
	'-P',
	'-R',
	'-d',
	'-f',
	'-i',
	'-r',
	'-v',
];
const expectedCompletions = [{ label: 'rm', description: (rmSpec as Fig.Subcommand).description }];
export const rmTestSuiteSpec: ISuiteSpec = {
	name: 'rm',
	completionSpecs: rmSpec,
	availableCommands: 'rm',
	testSpecs: [
		{ input: '|', expectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },

		{ input: 'r|', expectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },
		{ input: 'rm|', expectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },

		{ input: 'rm |', expectedCompletions: allOptions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },

	]
};

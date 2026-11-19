/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import { testPaths, type ISuiteSpec } from '../../helpers';
import gitSpec from '../../../completions/git';

const expectedCompletions = [{ label: 'git', description: (gitSpec as Fig.Subcommand).description }];

export const gitTestSuiteSpec: ISuiteSpec = {
	name: 'git',
	completionSpecs: gitSpec,
	availableCommands: 'git',
	testSpecs: [
		{ input: '|', expectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },

		{ input: 'g|', expectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },
		{ input: 'gi|', expectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },
		{ input: 'git|', expectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },


	],
};

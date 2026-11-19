/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import { testPaths, type ISuiteSpec } from '../../helpers';
import lsSpec from '../../../completions/upstream/ls';

const allOptions = [
	'-%',
	'-,',
	'--color <when>',
	'-1',
	'-@',
	'-A',
	'-B',
	'-C',
	'-F',
	'-G',
	'-H',
	'-L',
	'-O',
	'-P',
	'-R',
	'-S',
	'-T',
	'-U',
	'-W',
	'-a',
	'-b',
	'-c',
	'-d',
	'-e',
	'-f',
	'-g',
	'-h',
	'-i',
	'-k',
	'-l',
	'-m',
	'-n',
	'-o',
	'-p',
	'-q',
	'-r',
	'-s',
	'-t',
	'-u',
	'-v',
	'-w',
	'-x',
];
const expectedCompletions = [{ label: 'ls', description: (lsSpec as Fig.Subcommand).description }];
export const lsTestSuiteSpec: ISuiteSpec = {
	name: 'ls',
	completionSpecs: lsSpec,
	availableCommands: 'ls',
	testSpecs: [
		{ input: '|', expectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },

		{ input: 'l|', expectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },
		{ input: 'ls|', expectedCompletions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },

		{ input: 'ls |', expectedCompletions: allOptions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },
		{ input: 'ls -|', expectedCompletions: allOptions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },

		{ input: 'ls -a|', expectedCompletions: allOptions },

		{ input: 'ls -a -|', expectedCompletions: allOptions.filter(o => o !== '-a'), expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },

		{ input: 'ls c|', expectedCompletions: allOptions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },
		{ input: 'ls child|', expectedCompletions: allOptions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },
		{ input: 'ls .|', expectedCompletions: allOptions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },
		{ input: 'ls ./|', expectedCompletions: allOptions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },
		{ input: 'ls ./child|', expectedCompletions: allOptions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },
		{ input: 'ls ..|', expectedCompletions: allOptions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwd } },

		{ input: 'ls child/|', expectedCompletions: allOptions, expectedResourceRequests: { type: 'both', cwd: testPaths.cwdChild } },
		{ input: 'ls ../|', expectedCompletions: allOptions, expectedResourceRequests: { type: 'both' } },
		{ input: 'ls ../sibling|', expectedCompletions: allOptions, expectedResourceRequests: { type: 'both' } },
	]
};


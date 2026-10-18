/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IVoicePendingQuestion } from '../../../common/voiceClient/voiceClientService.js';
import { formatQuestionPrompt } from '../../../common/voiceClient/voicePendingNarration.js';

suite('formatQuestionPrompt', () => {
	ensureNoDisposablesAreLeakedInTestSuite();


	const single: IVoicePendingQuestion = {
		id: 'q_single',
		type: 'singleSelect',
		title: 'Which region?',
		allow_freeform: false,
		options: [
			{ label: 'West US', value: 'westus' },
			{ label: 'East US', value: 'eastus' },
		],
	};

	const multi: IVoicePendingQuestion = {
		id: 'q_multi',
		type: 'multiSelect',
		title: 'Which features?',
		allow_freeform: true,
		options: [
			{ label: 'Auth', value: 'auth' },
			{ label: 'Search', value: 'search' },
			{ label: 'Billing', value: 'billing' },
		],
	};

	const text: IVoicePendingQuestion = {
		id: 'q_text',
		type: 'text',
		title: 'Anything else?',
		allow_freeform: true,
		options: [],
	};

	test('single select', () => {
		assert.strictEqual(
			formatQuestionPrompt(single, false),
			'Which region? Options: 1, West US. 2, East US.',
		);
	});

	test('appends the skip hint when the form allows skipping', () => {
		assert.strictEqual(
			formatQuestionPrompt(single, true),
			'Which region? Options: 1, West US. 2, East US. Or say skip.',
		);
	});

	test('mentions freeform when the question allows it', () => {
		assert.strictEqual(
			formatQuestionPrompt(multi, false),
			'Which features? Options: 1, Auth. 2, Search. 3, Billing. You can also give your own answer.',
		);
	});

	test('a text question is just its title', () => {
		assert.strictEqual(formatQuestionPrompt(text, false), 'Anything else?');
	});

	test('a text question with skip', () => {
		assert.strictEqual(formatQuestionPrompt(text, true), 'Anything else? Or say skip.');
	});

	test('tolerates an empty title', () => {
		assert.strictEqual(
			formatQuestionPrompt({ ...single, title: '' }, false),
			'Options: 1, West US. 2, East US.',
		);
	});

	test('reads the ordinals it was given rather than renumbering', () => {
		assert.strictEqual(
			formatQuestionPrompt(
				{
					...single,
					options: [
						{ label: 'East US', value: 'eastus' },
						{ label: 'West US', value: 'westus' },
					],
				},
				false,
			),
			'Which region? Options: 1, East US. 2, West US.',
		);
	});
});

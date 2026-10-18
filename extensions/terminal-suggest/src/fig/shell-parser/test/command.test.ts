/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'node:assert';
import { getCommand, Command } from '../command';

suite('fig/shell-parser/ getCommand', () => {
	const aliases = {
		woman: 'man',
		quote: `'q'`,
		g: 'git',
	};
	const getTokenText = (command: Command | null) => command?.tokens.map((token) => token.text) ?? [];

	test('works without matching aliases', () => {
		deepStrictEqual(getTokenText(getCommand('git co ', {})), ['git', 'co', '']);
		deepStrictEqual(getTokenText(getCommand('git co ', aliases)), ['git', 'co', '']);
		deepStrictEqual(getTokenText(getCommand('woman ', {})), ['woman', '']);
		deepStrictEqual(getTokenText(getCommand('another string ', aliases)), [
			'another',
			'string',
			'',
		]);
	});

	test('works with regular aliases', () => {
		deepStrictEqual(getTokenText(getCommand('woman', aliases)), ['woman']);
		deepStrictEqual(getTokenText(getCommand('woman ', aliases)), ['man', '']);
		deepStrictEqual(getTokenText(getCommand('man woman ', aliases)), ['man', 'woman', '']);
		deepStrictEqual(getTokenText(getCommand('quote ', aliases)), ['q', '']);
	});
});

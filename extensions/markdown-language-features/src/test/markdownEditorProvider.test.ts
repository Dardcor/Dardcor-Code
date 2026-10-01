/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import 'mocha';



import { encodeWebviewInitialState } from '../preview/webviewInitialState';


suite('Markdown editor initial state', () => {
	test('safely round-trips document content', () => {
		const state = {
			content: '</meta><script>globalThis.modified = true</script><!--\n# Heading "quoted"',
			documentVersion: 17,
			readonly: true,
		};
		const encoded = encodeWebviewInitialState(state);

		assert.deepStrictEqual({
			containsHtmlAttributeSyntax: /["<>&]/.test(encoded),
			roundTrip: JSON.parse(decodeURIComponent(encoded)),
		}, {
			containsHtmlAttributeSyntax: false,
			roundTrip: state,
		});
	});
});


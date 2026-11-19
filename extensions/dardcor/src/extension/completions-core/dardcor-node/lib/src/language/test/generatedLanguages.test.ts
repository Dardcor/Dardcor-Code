/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { knownLanguages } from '../generatedLanguages';
import { languageMarkers } from '../../../../prompt/src/languageMarker';
import * as assert from 'assert';

suite('generated languages', function () {
	const ignoredMappings = ['jsx', 'tex', 'vue-html'];

	for (const marker in languageMarkers) {
		if (!ignoredMappings.includes(marker)) {
			test(`'${marker}' is generated`, function () {
				assert.ok(
					marker in knownLanguages,
					'language for comment marker ' + marker + ' has not been generated'
				);
			});
		}
	}
});

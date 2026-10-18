/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Range } from '../../../../common/core/range.js';
import { IColorInformation } from '../../../../common/languages.js';
import { DefaultDocumentColorProvider } from '../../browser/defaultDocumentColorProvider.js';

suite('DefaultDocumentColorProvider', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('Color presentations should not include alpha channel when alpha is 1', () => {
		const provider = new DefaultDocumentColorProvider(null!);

		const opaqueColorInfo: IColorInformation = {
			range: new Range(1, 1, 1, 10),
			color: {
				red: 1,
				green: 0,
				blue: 0,
				alpha: 1
			}
		};

		const opaquePresentations = provider.provideColorPresentations(null!, opaqueColorInfo, CancellationToken.None);
		assert.strictEqual(opaquePresentations[0].label, 'rgb(255, 0, 0)', 'RGB should not include alpha when alpha is 1');
		assert.strictEqual(opaquePresentations[1].label, 'hsl(0, 100%, 50%)', 'HSL should not include alpha when alpha is 1');
		assert.strictEqual(opaquePresentations[2].label, '#ff0000', 'HEX should not include alpha when alpha is 1');
	});

	test('Color presentations should include alpha channel when alpha is not 1', () => {
		const provider = new DefaultDocumentColorProvider(null!);

		const transparentColorInfo: IColorInformation = {
			range: new Range(1, 1, 1, 10),
			color: {
				red: 0,
				green: 0,
				blue: 0,
				alpha: 0
			}
		};

		const transparentPresentations = provider.provideColorPresentations(null!, transparentColorInfo, CancellationToken.None);
		assert.strictEqual(transparentPresentations[0].label, 'rgba(0, 0, 0, 0)', 'RGB should include alpha when alpha is 0');
		assert.strictEqual(transparentPresentations[1].label, 'hsla(0, 0%, 0%, 0.00)', 'HSL should include alpha when alpha is 0');
		assert.strictEqual(transparentPresentations[2].label, '#00000000', 'HEX should include alpha when alpha is 0');
	});

	test('Color presentations should include alpha channel when alpha is between 0 and 1', () => {
		const provider = new DefaultDocumentColorProvider(null!);

		const semiTransparentColorInfo: IColorInformation = {
			range: new Range(1, 1, 1, 10),
			color: {
				red: 0.67,
				green: 0,
				blue: 0,
				alpha: 0.67
			}
		};

		const semiTransparentPresentations = provider.provideColorPresentations(null!, semiTransparentColorInfo, CancellationToken.None);
		assert.strictEqual(semiTransparentPresentations[0].label, 'rgba(171, 0, 0, 0.67)', 'RGB should include alpha when alpha is 0.67');
		assert.strictEqual(semiTransparentPresentations[1].label, 'hsla(0, 100%, 34%, 0.67)', 'HSL should include alpha when alpha is 0.67');
		assert.strictEqual(semiTransparentPresentations[2].label, '#ab0000ab', 'HEX should include alpha when alpha is 0.67');
	});

	test('Regression test for issue #243746: opacity should be preserved when switching to hex format', () => {
		const provider = new DefaultDocumentColorProvider(null!);

		const colorWithOpacity: IColorInformation = {
			range: new Range(1, 1, 1, 10),
			color: {
				red: 0.5,
				green: 0.5,
				blue: 0.5,
				alpha: 0.5
			}
		};

		const presentations = provider.provideColorPresentations(null!, colorWithOpacity, CancellationToken.None);

		assert.strictEqual(presentations[2].label, '#80808080', 'HEX format should preserve opacity (issue #243746)');
	});

	test('Regression test for issue #256853: fully opaque colors should not add unnecessary alpha suffix', () => {
		const provider = new DefaultDocumentColorProvider(null!);

		const fullyOpaqueColor: IColorInformation = {
			range: new Range(1, 1, 1, 10),
			color: {
				red: 0.58,
				green: 0.36,
				blue: 0.65,
				alpha: 1
			}
		};

		const presentations = provider.provideColorPresentations(null!, fullyOpaqueColor, CancellationToken.None);

		assert.strictEqual(presentations[2].label, '#945ca6', 'HEX format should not add ff suffix when fully opaque (issue #256853)');
	});
});

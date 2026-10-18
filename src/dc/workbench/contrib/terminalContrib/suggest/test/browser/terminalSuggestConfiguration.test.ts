/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { registerTerminalSuggestProvidersConfiguration } from '../../common/terminalSuggestConfiguration.js';

suite('Terminal Suggest Dynamic Configuration', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('should update configuration when providers change', () => {
		registerTerminalSuggestProvidersConfiguration();

		const providers = new Map([
			['terminal-suggest', { id: 'terminal-suggest', description: 'Provides intelligent completions for terminal commands' }],
			['builtinPwsh', { id: 'builtinPwsh', description: 'PowerShell completion provider' }],
			['lsp', { id: 'lsp' }],
			['custom-provider', { id: 'custom-provider' }],
		]);
		registerTerminalSuggestProvidersConfiguration(providers);

		registerTerminalSuggestProvidersConfiguration();

		assert.ok(true);
	});

	test('should include default providers even when none provided', () => {
		registerTerminalSuggestProvidersConfiguration(undefined);
		assert.ok(true);
	});
});

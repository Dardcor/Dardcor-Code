/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { LanguagesRegistry } from '../../../editor/common/services/languagesRegistry.js';

export function assertCleanState(): void {
	assert.strictEqual(LanguagesRegistry.instanceCount, 0, 'Error: Test run should not leak in LanguagesRegistry.');
}

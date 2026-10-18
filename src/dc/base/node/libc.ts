/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { familySync, MUSL } from 'detect-libc';
import * as Platform from '../common/platform.js';

export type LibcFamily = 'glibc' | 'musl';

let _cached: LibcFamily | undefined;
let _cacheValid = false;

export function detectLibcSync(): LibcFamily | undefined {
	if (_cacheValid) {
		return _cached;
	}
	if (Platform.isLinux) {
		_cached = familySync() === MUSL ? 'musl' : 'glibc';
	} else {
		_cached = undefined;
	}
	_cacheValid = true;
	return _cached;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../util/dardcor/base/common/lifecycle';
import { ensureDependenciesAreSet } from '../../../util/dardcor/editor/common/core/text/positionToOffset';

export function createTimeout(ms: number, cb: () => void): IDisposable {
	const t = setTimeout(cb, ms);
	return toDisposable(() => clearTimeout(t));
}

ensureDependenciesAreSet();

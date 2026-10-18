/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type tt from 'typescript/lib/tsserverlibrary';
import type * as c from './create';

import TS from '../common/typescript';

let initCalled: boolean = false;
let create: typeof c.create | undefined = undefined;
function init(module: { typescript: typeof tt }) {
	if (!initCalled) {
		try {
			TS.install(module.typescript);
			create = (require('./create') as typeof c).create;
		} finally {
			initCalled = true;
		}
	}

	if (create === undefined) {
		throw new Error(`Couldn't initialize TypeScript Context Server Plugin.`);
	}

	return { create };
}
export = init;

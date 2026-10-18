/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';

export class StickyRange {
	constructor(
		public readonly startLineNumber: number,
		public readonly endLineNumber: number
	) { }
}

export class StickyElement {

	constructor(
		public readonly range: StickyRange | undefined,
		public readonly children: StickyElement[],
		public readonly parent: StickyElement | undefined
	) {
	}
}

export class StickyModel {
	constructor(
		readonly uri: URI,
		readonly version: number,
		readonly element: StickyElement | undefined,
		readonly outlineProviderId: string | undefined
	) { }
}

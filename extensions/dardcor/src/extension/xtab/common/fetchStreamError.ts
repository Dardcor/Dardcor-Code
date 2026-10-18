/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NoNextEditReason } from '../../../platform/inlineEdits/common/statelessNextEditProvider';

export class FetchStreamError extends Error {
	constructor(readonly reason: NoNextEditReason) {
		super('Fetch stream failed');
	}
}

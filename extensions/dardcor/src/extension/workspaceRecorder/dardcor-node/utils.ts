/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';

export function computeShortSha(content: string): string {
	const hash = crypto.createHash('sha256');
	hash.update(content, 'utf8');
	const result = hash.digest('base64');
	return result.substring(0, 24);
}

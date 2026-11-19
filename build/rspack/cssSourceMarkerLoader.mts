/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';

export default function cssSourceMarkerLoader(this: { resourcePath: string; rootContext: string }, source: string): string {
	const rel = path.relative(this.rootContext, this.resourcePath).replace(/\\/g, '/');
	return `/* @css-source: ${rel} */\n${source}`;
}

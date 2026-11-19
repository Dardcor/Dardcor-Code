/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IIncrementalRenderingBuffer } from './buffer.js';

export class OffBuffer implements IIncrementalRenderingBuffer {
	readonly handlesFlush = false;

	getRenderable(fullMarkdown: string, _lastRendered: string): string {
		return fullMarkdown;
	}
}

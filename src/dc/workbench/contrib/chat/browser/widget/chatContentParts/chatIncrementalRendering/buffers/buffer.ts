/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IIncrementalRenderingBuffer {
	readonly handlesFlush: boolean;

	getRenderable(fullMarkdown: string, lastRendered: string): string;

	filterFlush?(markdown: string): string | undefined;

	readonly needsNextFrame?: boolean;

	dispose?(): void;
}

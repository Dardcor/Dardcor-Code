/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IIncrementalRenderingAnimation {
	animate(children: HTMLCollection, fromIndex: number, currentCount: number, elapsed: number): void;
}

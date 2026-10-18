/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NKeyMap } from '../../../../base/common/map.js';

export interface IDecorationStyleSet {
	color: number | undefined;
	bold: boolean | undefined;
	opacity: number | undefined;
	strikethrough: boolean | undefined;
	strikethroughThickness: number | undefined;
	strikethroughColor: number | undefined;
}

export interface IDecorationStyleCacheEntry extends IDecorationStyleSet {
	id: number;
}

export class DecorationStyleCache {

	private _nextId = 1;

	private readonly _cacheById = new Map<number, IDecorationStyleCacheEntry>();
	private readonly _cacheByStyle = new NKeyMap<IDecorationStyleCacheEntry, [number, number, string, number, string, number]>();

	getOrCreateEntry(
		color: number | undefined,
		bold: boolean | undefined,
		opacity: number | undefined,
		strikethrough: boolean | undefined,
		strikethroughThickness: number | undefined,
		strikethroughColor: number | undefined
	): number {
		if (color === undefined && bold === undefined && opacity === undefined && strikethrough === undefined && strikethroughThickness === undefined && strikethroughColor === undefined) {
			return 0;
		}
		const result = this._cacheByStyle.get(
			color ?? 0,
			bold ? 1 : 0,
			opacity === undefined ? '' : opacity.toFixed(2),
			strikethrough ? 1 : 0,
			strikethroughThickness === undefined ? '' : strikethroughThickness.toFixed(2),
			strikethroughColor ?? 0
		);
		if (result) {
			return result.id;
		}
		const id = this._nextId++;
		const entry: IDecorationStyleCacheEntry = {
			id,
			color,
			bold,
			opacity,
			strikethrough,
			strikethroughThickness,
			strikethroughColor,
		};
		this._cacheById.set(id, entry);
		this._cacheByStyle.set(entry,
			color ?? 0,
			bold ? 1 : 0,
			opacity === undefined ? '' : opacity.toFixed(2),
			strikethrough ? 1 : 0,
			strikethroughThickness === undefined ? '' : strikethroughThickness.toFixed(2),
			strikethroughColor ?? 0
		);
		return id;
	}

	getStyleSet(id: number): IDecorationStyleSet | undefined {
		if (id === 0) {
			return undefined;
		}
		return this._cacheById.get(id);
	}
}

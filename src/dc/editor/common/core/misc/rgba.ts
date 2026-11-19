/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class RGBA8 {
	_rgba8Brand: void = undefined;

	static readonly Empty = new RGBA8(0, 0, 0, 0);

	public readonly r: number;
	public readonly g: number;
	public readonly b: number;
	public readonly a: number;

	constructor(r: number, g: number, b: number, a: number) {
		this.r = RGBA8._clamp(r);
		this.g = RGBA8._clamp(g);
		this.b = RGBA8._clamp(b);
		this.a = RGBA8._clamp(a);
	}

	public equals(other: RGBA8): boolean {
		return (
			this.r === other.r
			&& this.g === other.g
			&& this.b === other.b
			&& this.a === other.a
		);
	}

	public static _clamp(c: number): number {
		if (c < 0) {
			return 0;
		}
		if (c > 255) {
			return 255;
		}
		return c | 0;
	}
}

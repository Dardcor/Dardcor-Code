/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export interface IGlyphRasterizer {
	readonly id: number;

	readonly cacheKey: string;

	rasterizeGlyph(
		chars: string,
		tokenMetadata: number,
		decorationStyleSetId: number,
		colorMap: string[],
	): Readonly<IRasterizedGlyph>;

	getTextMetrics(text: string): TextMetrics;
}

export interface IBoundingBox {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface IRasterizedGlyph {
	source: OffscreenCanvas;
	boundingBox: IBoundingBox;
	originOffset: { x: number; y: number };
	fontBoundingBoxAscent: number;
	fontBoundingBoxDescent: number;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getActiveWindow } from '../../../../base/browser/dom.js';
import { CharCode } from '../../../../base/common/charCode.js';
import { BugIndicatingError } from '../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, dispose, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { NKeyMap } from '../../../../base/common/map.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { MetadataConsts } from '../../../common/encodedTokenAttributes.js';
import type { DecorationStyleCache } from '../css/decorationStyleCache.js';
import { GlyphRasterizer } from '../raster/glyphRasterizer.js';
import type { IGlyphRasterizer } from '../raster/raster.js';
import { IdleTaskQueue, type ITaskQueue } from '../taskQueue.js';
import type { IReadableTextureAtlasPage, ITextureAtlasPageGlyph, GlyphMap } from './atlas.js';
import { AllocatorType, TextureAtlasPage } from './textureAtlasPage.js';

export interface ITextureAtlasOptions {
	allocatorType?: AllocatorType;
}

export class TextureAtlas extends Disposable {
	private _colorMap?: string[];
	private readonly _warmUpTask: MutableDisposable<ITaskQueue> = this._register(new MutableDisposable());
	private readonly _warmedUpRasterizers = new Set<number>();
	private readonly _allocatorType: AllocatorType;

	static readonly maximumPageCount = 16;

	private readonly _pages: TextureAtlasPage[] = [];
	get pages(): IReadableTextureAtlasPage[] { return this._pages; }

	readonly pageSize: number;

	private readonly _glyphPageIndex: GlyphMap<number> = new NKeyMap();

	private readonly _onDidDeleteGlyphs = this._register(new Emitter<void>());
	readonly onDidDeleteGlyphs = this._onDidDeleteGlyphs.event;

	constructor(
		private readonly _maxTextureSize: number,
		options: ITextureAtlasOptions | undefined,
		private readonly _decorationStyleCache: DecorationStyleCache,
		@IThemeService private readonly _themeService: IThemeService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		super();

		this._allocatorType = options?.allocatorType ?? 'slab';

		this._register(Event.runAndSubscribe(this._themeService.onDidColorThemeChange, () => {
			if (this._colorMap) {
				this.clear();
			}
			this._colorMap = this._themeService.getColorTheme().tokenColorMap;
		}));

		const dprFactor = Math.max(1, Math.floor(getActiveWindow().devicePixelRatio));

		this.pageSize = Math.min(1024 * dprFactor, this._maxTextureSize);
		this._initFirstPage();

		this._register(toDisposable(() => dispose(this._pages)));
	}

	private _initFirstPage() {
		const firstPage = this._instantiationService.createInstance(TextureAtlasPage, 0, this.pageSize, this._allocatorType);
		this._pages.push(firstPage);

		const nullRasterizer = new GlyphRasterizer(1, '', 1, this._decorationStyleCache);
		firstPage.getGlyph(nullRasterizer, '', 0, 0);
		nullRasterizer.dispose();
	}

	clear() {
		for (const page of this._pages) {
			page.dispose();
		}
		this._pages.length = 0;
		this._glyphPageIndex.clear();
		this._warmedUpRasterizers.clear();
		this._warmUpTask.clear();

		this._initFirstPage();

		this._onDidDeleteGlyphs.fire();
	}

	getGlyph(rasterizer: IGlyphRasterizer, chars: string, tokenMetadata: number, decorationStyleSetId: number, x: number): Readonly<ITextureAtlasPageGlyph> {
		tokenMetadata &= ~(MetadataConsts.LANGUAGEID_MASK | MetadataConsts.TOKEN_TYPE_MASK | MetadataConsts.BALANCED_BRACKETS_MASK);

		tokenMetadata |= Math.floor((x % 1) * 10);

		if (!this._warmedUpRasterizers.has(rasterizer.id)) {
			this._warmUpAtlas(rasterizer);
			this._warmedUpRasterizers.add(rasterizer.id);
		}

		return this._tryGetGlyph(this._glyphPageIndex.get(chars, tokenMetadata, decorationStyleSetId, rasterizer.cacheKey) ?? 0, rasterizer, chars, tokenMetadata, decorationStyleSetId);
	}

	private _tryGetGlyph(pageIndex: number, rasterizer: IGlyphRasterizer, chars: string, tokenMetadata: number, decorationStyleSetId: number): Readonly<ITextureAtlasPageGlyph> {
		this._glyphPageIndex.set(pageIndex, chars, tokenMetadata, decorationStyleSetId, rasterizer.cacheKey);
		return (
			this._pages[pageIndex].getGlyph(rasterizer, chars, tokenMetadata, decorationStyleSetId)
			?? (pageIndex + 1 < this._pages.length
				? this._tryGetGlyph(pageIndex + 1, rasterizer, chars, tokenMetadata, decorationStyleSetId)
				: undefined)
			?? this._getGlyphFromNewPage(rasterizer, chars, tokenMetadata, decorationStyleSetId)
		);
	}

	private _getGlyphFromNewPage(rasterizer: IGlyphRasterizer, chars: string, tokenMetadata: number, decorationStyleSetId: number): Readonly<ITextureAtlasPageGlyph> {
		if (this._pages.length >= TextureAtlas.maximumPageCount) {
			throw new Error(`Attempt to create a texture atlas page past the limit ${TextureAtlas.maximumPageCount}`);
		}
		this._pages.push(this._instantiationService.createInstance(TextureAtlasPage, this._pages.length, this.pageSize, this._allocatorType));
		this._glyphPageIndex.set(this._pages.length - 1, chars, tokenMetadata, decorationStyleSetId, rasterizer.cacheKey);
		return this._pages[this._pages.length - 1].getGlyph(rasterizer, chars, tokenMetadata, decorationStyleSetId)!;
	}

	public getUsagePreview(): Promise<Blob[]> {
		return Promise.all(this._pages.map(e => e.getUsagePreview()));
	}

	public getStats(): string[] {
		return this._pages.map(e => e.getStats());
	}

	private _warmUpAtlas(rasterizer: IGlyphRasterizer): void {
		const colorMap = this._colorMap;
		if (!colorMap) {
			throw new BugIndicatingError('Cannot warm atlas without color map');
		}
		this._warmUpTask.value?.clear();
		const taskQueue = this._warmUpTask.value = this._instantiationService.createInstance(IdleTaskQueue);
		for (let code = CharCode.A; code <= CharCode.Z; code++) {
			for (const fgColor of colorMap.keys()) {
				taskQueue.enqueue(() => {
					for (let x = 0; x < 1; x += 0.1) {
						this.getGlyph(rasterizer, String.fromCharCode(code), (fgColor << MetadataConsts.FOREGROUND_OFFSET) & MetadataConsts.FOREGROUND_MASK, 0, x);
					}
				});
			}
		}
		for (let code = CharCode.a; code <= CharCode.z; code++) {
			for (const fgColor of colorMap.keys()) {
				taskQueue.enqueue(() => {
					for (let x = 0; x < 1; x += 0.1) {
						this.getGlyph(rasterizer, String.fromCharCode(code), (fgColor << MetadataConsts.FOREGROUND_OFFSET) & MetadataConsts.FOREGROUND_MASK, 0, x);
					}
				});
			}
		}
		for (let code = CharCode.ExclamationMark; code <= CharCode.Tilde; code++) {
			for (const fgColor of colorMap.keys()) {
				taskQueue.enqueue(() => {
					for (let x = 0; x < 1; x += 0.1) {
						this.getGlyph(rasterizer, String.fromCharCode(code), (fgColor << MetadataConsts.FOREGROUND_OFFSET) & MetadataConsts.FOREGROUND_MASK, 0, x);
					}
				});
			}
		}
	}
}


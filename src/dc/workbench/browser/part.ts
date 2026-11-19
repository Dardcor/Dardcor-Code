/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/part.css';
import './media/floatingPanels.css';
import { Component } from '../common/component.js';
import { IThemeService, IColorTheme } from '../../platform/theme/common/themeService.js';
import { Dimension, size, IDimension, getActiveDocument, prepend, IDomPosition } from '../../base/browser/dom.js';
import { IStorageService } from '../../platform/storage/common/storage.js';
import { ISerializableView, IViewSize } from '../../base/browser/ui/grid/grid.js';
import { Event, Emitter } from '../../base/common/event.js';
import { IWorkbenchLayoutService } from '../services/layout/browser/layoutService.js';
import { assertReturnsDefined } from '../../base/common/types.js';
import { IDisposable, toDisposable } from '../../base/common/lifecycle.js';

export interface IPartOptions {
	readonly hasTitle?: boolean;
	readonly borderWidth?: () => number;
}

export interface ILayoutContentResult {
	readonly headerSize: IDimension;
	readonly titleSize: IDimension;
	readonly contentSize: IDimension;
	readonly footerSize: IDimension;
}

export abstract class Part<MementoType extends object = object> extends Component<MementoType> implements ISerializableView {

	private _dimension: Dimension | undefined;
	get dimension(): Dimension | undefined { return this._dimension; }

	private _contentPosition: IDomPosition | undefined;
	get contentPosition(): IDomPosition | undefined { return this._contentPosition; }

	protected _onDidVisibilityChange = this._register(new Emitter<boolean>());
	readonly onDidVisibilityChange = this._onDidVisibilityChange.event;

	private parent: HTMLElement | undefined;
	private headerArea: HTMLElement | undefined;
	protected titleArea: HTMLElement | undefined;
	protected contentArea: HTMLElement | undefined;
	private footerArea: HTMLElement | undefined;
	private partLayout: PartLayout | undefined;

	constructor(
		id: string,
		protected options: IPartOptions,
		themeService: IThemeService,
		storageService: IStorageService,
		protected readonly layoutService: IWorkbenchLayoutService
	) {
		super(id, themeService, storageService);

		this._register(layoutService.registerPart(this));
	}

	protected override onThemeChange(theme: IColorTheme): void {

		if (this.parent) {
			super.onThemeChange(theme);
		}
	}

	create(parent: HTMLElement, options?: object): void {
		this.parent = parent;
		this.titleArea = this.createTitleArea(parent, options);
		this.contentArea = this.createContentArea(parent, options);

		this.partLayout = new PartLayout(this.options, this.contentArea);

		this.updateStyles();
	}

	getContainer(): HTMLElement | undefined {
		return this.parent;
	}

	protected createTitleArea(parent: HTMLElement, options?: object): HTMLElement | undefined {
		return undefined;
	}

	protected createContentArea(parent: HTMLElement, options?: object): HTMLElement | undefined {
		return undefined;
	}

	protected setHeaderArea(headerContainer: HTMLElement): void {
		if (this.headerArea) {
			throw new Error('Header already exists');
		}

		if (!this.parent || !this.titleArea) {
			return;
		}

		prepend(this.parent, headerContainer);
		headerContainer.classList.add('header-or-footer');
		headerContainer.classList.add('header');

		this.headerArea = headerContainer;
		this.partLayout?.setHeaderVisibility(true);
		this.relayout();
	}

	protected setFooterArea(footerContainer: HTMLElement): void {
		if (this.footerArea) {
			throw new Error('Footer already exists');
		}

		if (!this.parent || !this.titleArea) {
			return;
		}

		this.parent.appendChild(footerContainer);
		footerContainer.classList.add('header-or-footer');
		footerContainer.classList.add('footer');

		this.footerArea = footerContainer;
		this.partLayout?.setFooterVisibility(true);
		this.relayout();
	}

	protected removeHeaderArea(): void {
		if (this.headerArea) {
			this.headerArea.remove();
			this.headerArea = undefined;
			this.partLayout?.setHeaderVisibility(false);
			this.relayout();
		}
	}

	protected removeFooterArea(): void {
		if (this.footerArea) {
			this.footerArea.remove();
			this.footerArea = undefined;
			this.partLayout?.setFooterVisibility(false);
			this.relayout();
		}
	}

	private relayout() {
		const dimension = this.getRelayoutDimension();
		if (dimension && this.contentPosition) {
			this.layout(dimension.width, dimension.height, this.contentPosition.top, this.contentPosition.left);
		}
	}

	protected getRelayoutDimension(): Dimension | undefined {
		return this._dimension;
	}

	protected layoutContents(width: number, height: number): ILayoutContentResult {
		const partLayout = assertReturnsDefined(this.partLayout);

		return partLayout.layout(width, height);
	}


	protected _onDidChange = this._register(new Emitter<IViewSize | undefined>());
	get onDidChange(): Event<IViewSize | undefined> { return this._onDidChange.event; }

	element!: HTMLElement;

	abstract minimumWidth: number;
	abstract maximumWidth: number;
	abstract minimumHeight: number;
	abstract maximumHeight: number;

	layout(width: number, height: number, top: number, left: number): void {
		this._dimension = new Dimension(width, height);
		this._contentPosition = { top, left };
	}

	setVisible(visible: boolean) {
		this._onDidVisibilityChange.fire(visible);
	}

	abstract toJSON(): object;

}

class PartLayout {

	private static readonly HEADER_HEIGHT = 35;
	private static readonly TITLE_HEIGHT = 35;
	private static readonly FOOTER_HEIGHT = 35;
	private static readonly AREA_HEIGHT_STYLE_OVERRIDE = 32;

	private headerVisible: boolean = false;
	private footerVisible: boolean = false;

	constructor(private options: IPartOptions, private contentArea: HTMLElement | undefined) { }

	layout(width: number, height: number): ILayoutContentResult {
		const isStyleOverride = !!this.contentArea?.closest('.style-override');

		let titleSize: Dimension;
		if (this.options.hasTitle) {
			const titleHeight = isStyleOverride ? PartLayout.AREA_HEIGHT_STYLE_OVERRIDE : PartLayout.TITLE_HEIGHT;
			titleSize = new Dimension(width, Math.min(height, titleHeight));
		} else {
			titleSize = Dimension.None;
		}

		let headerSize: Dimension;
		if (this.headerVisible) {
			const headerHeight = isStyleOverride ? PartLayout.AREA_HEIGHT_STYLE_OVERRIDE : PartLayout.HEADER_HEIGHT;
			headerSize = new Dimension(width, Math.min(height, headerHeight));
		} else {
			headerSize = Dimension.None;
		}

		let footerSize: Dimension;
		if (this.footerVisible) {
			const footerHeight = isStyleOverride ? PartLayout.AREA_HEIGHT_STYLE_OVERRIDE : PartLayout.FOOTER_HEIGHT;
			footerSize = new Dimension(width, Math.min(height, footerHeight));
		} else {
			footerSize = Dimension.None;
		}

		let contentWidth = width;
		if (this.options && typeof this.options.borderWidth === 'function') {
			contentWidth -= this.options.borderWidth();
		}

		const contentSize = new Dimension(contentWidth, height - titleSize.height - headerSize.height - footerSize.height);

		if (this.contentArea) {
			size(this.contentArea, contentSize.width, contentSize.height);
		}

		return { headerSize, titleSize, contentSize, footerSize };
	}

	setFooterVisibility(visible: boolean): void {
		this.footerVisible = visible;
	}

	setHeaderVisibility(visible: boolean): void {
		this.headerVisible = visible;
	}
}

export interface IMultiWindowPart {
	readonly element: HTMLElement;
}

export abstract class MultiWindowParts<T extends IMultiWindowPart, MementoType extends object = object> extends Component<MementoType> {

	protected readonly _parts = new Set<T>();
	get parts() { return Array.from(this._parts); }

	abstract readonly mainPart: T;

	registerPart(part: T): IDisposable {
		this._parts.add(part);

		return toDisposable(() => this.unregisterPart(part));
	}

	protected unregisterPart(part: T): void {
		this._parts.delete(part);
	}

	getPart(container: HTMLElement): T {
		return this.getPartByDocument(container.ownerDocument);
	}

	protected getPartByDocument(document: Document): T {
		if (this._parts.size > 1) {
			for (const part of this._parts) {
				if (part.element?.ownerDocument === document) {
					return part;
				}
			}
		}

		return this.mainPart;
	}

	get activePart(): T {
		return this.getPartByDocument(getActiveDocument());
	}
}

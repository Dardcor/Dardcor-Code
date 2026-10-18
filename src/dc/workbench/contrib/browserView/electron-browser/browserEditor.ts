/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/browser.css';
import { localize, localize2 } from '../../../../nls.js';
import { $, Dimension, IDomPosition } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ContextKeyExpr, IContextKey, RawContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService, IConstructorSignature, BrandedService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { BrowserEditorInput } from '../common/browserEditorInput.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { IQuickInputButton } from '../../../../platform/quickinput/common/quickInput.js';
import { IBrowserViewModel } from '../../browserView/common/browserView.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { getZoomFactor, onDidChangeZoomLevel } from '../../../../base/browser/browser.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IAction } from '../../../../base/common/actions.js';
import { IActionViewItem } from '../../../../base/browser/ui/actionbar/actionbar.js';
import { IActionViewItemOptions } from '../../../../base/browser/ui/actionbar/actionViewItems.js';

export const CONTEXT_BROWSER_FOCUSED = new RawContextKey<boolean>('browserFocused', true, localize('browser.editorFocused', "Whether the browser editor is focused"));
export const CONTEXT_BROWSER_HAS_URL = new RawContextKey<boolean>('browserHasUrl', false, localize('browser.hasUrl', "Whether the browser has a URL loaded"));
export const CONTEXT_BROWSER_HAS_ERROR = new RawContextKey<boolean>('browserHasError', false, localize('browser.hasError', "Whether the browser has a load error"));

export const BROWSER_EDITOR_ACTIVE = ContextKeyExpr.equals('activeEditor', BrowserEditorInput.EDITOR_ID);

export const BrowserActionCategory = localize2('browserCategory', "Browser");

export enum BrowserActionGroup {
	Tabs = '1_tabs',
	Zoom = '2_zoom',
	Tools = '3_tools',
	Data = '4_data',
	Settings = '5_settings'
}

const originalHtmlElementFocus = HTMLElement.prototype.focus;


export abstract class BrowserEditorContribution extends Disposable {
	private readonly _modelStore = this._register(new DisposableStore());

	constructor(protected readonly editor: BrowserEditor) {
		super();
		this._register(editor.onDidChangeModel(({ model, isNew }) => {
			this._modelStore.clear();
			if (model) {
				this.onModelAttached(model, this._modelStore, isNew);
			} else {
				this.onModelDetached();
			}
		}));
	}

	protected onModelAttached(_model: IBrowserViewModel, _store: DisposableStore, _isNew: boolean): void { }

	onModelDetached(): void { }

	prerenderInput(_input: BrowserEditorInput): void { }

	get widgets(): readonly IBrowserEditorWidget[] { return []; }

	get urlRenderers(): readonly IBrowserUrlRenderer[] { return []; }

	get urlSuggestionProviders(): readonly IBrowserUrlSuggestionProvider[] { return []; }

	get urlPickerActionProviders(): readonly IBrowserUrlPickerActionProvider[] { return []; }

	getActionViewItem(_action: IAction, _options: IActionViewItemOptions, _instantiationService: IInstantiationService): IActionViewItem | undefined { return undefined; }

	readonly onDidChangeActionViewItems: Event<void> = Event.None;

	onPaneResized(_width: number): void { }

	afterContainerLayout(): void { }

	onPaneVisibilityChanged(_visible: boolean): void { }

	tryFocus(): boolean { return false; }

	onContainerCreated(_container: HTMLElement): void { }

	beforeContainerLayout(): IContainerLayoutOverride | undefined { return undefined; }
}

export interface IContainerLayoutOverride {
	readonly padding?: {
		top?: number;
		right?: number;
		bottom?: number;
		left?: number;
	};
	readonly compute?: (current: IContainerLayout, pane: IContainerLayoutPane) => IContainerLayout | undefined;
	readonly priority?: number;
}

export interface IContainerLayoutPane {
	readonly width: number;
	readonly height: number;
	readonly originX: number;
	readonly originY: number;
}

export interface IContainerLayout {
	readonly width: number;
	readonly height: number;
	readonly top?: number;
	readonly left?: number;
	readonly emulation?: {
		readonly scale: number;
	};
}

export const enum BrowserWidgetLocation {
	PreUrl = 'preUrl',
	PostUrl = 'postUrl',
	Toolbar = 'toolbar',
	ContentArea = 'contentArea',
}

export interface IBrowserEditorWidget {
	readonly location: BrowserWidgetLocation;
	readonly element: HTMLElement;
	readonly order: number;
}

export interface IBrowserUrlRenderer {
	render(url: string, container: HTMLElement): boolean;
	readonly onDidChange: Event<void>;
}

export interface IBrowserUrlSuggestion {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly icon?: ThemeIcon;
	readonly iconPath?: { dark: URI; light?: URI };
	readonly actions?: readonly IBrowserUrlSuggestionAction[];
	apply(input: BrowserEditorInput): void | Promise<void>;
}

export interface IBrowserUrlSuggestionAction extends IQuickInputButton {
	readonly id: string;
	run(input: BrowserEditorInput): void | Promise<void>;
}

export interface IBrowserUrlSuggestionContext {
	readonly text: string;
	readonly input: BrowserEditorInput;
}

export interface IBrowserUrlSuggestionProvider {
	readonly label?: string;
	readonly description?: string;
	readonly order?: number;
	readonly actions?: readonly IBrowserUrlSuggestionAction[];
	readonly onDidChange?: Event<void>;
	getSuggestions(context: IBrowserUrlSuggestionContext, token: CancellationToken): Promise<readonly IBrowserUrlSuggestion[]>;
}

export interface IBrowserUrlPickerAction extends IQuickInputButton {
	readonly id: string;
	run(input: BrowserEditorInput): void | Promise<void>;
}

export interface IBrowserUrlPickerActionProvider {
	readonly onDidChange?: Event<void>;
	readonly order?: number;
	getActions(input: BrowserEditorInput): readonly IBrowserUrlPickerAction[];
}

export class BrowserEditor extends EditorPane {


	private static readonly _contributions: IConstructorSignature<BrowserEditorContribution, [BrowserEditor]>[] = [];
	static registerContribution<Services extends BrandedService[]>(ctor: { new(editor: BrowserEditor, ...services: Services): BrowserEditorContribution }): void {
		BrowserEditor._contributions.push(ctor as IConstructorSignature<BrowserEditorContribution, [BrowserEditor]>);
	}

	private readonly _contributionInstances = new Map<IConstructorSignature<BrowserEditorContribution, [BrowserEditor]>, BrowserEditorContribution>();
	getContribution<T extends BrowserEditorContribution, Services extends BrandedService[]>(ctor: { new(editor: BrowserEditor, ...services: Services): T }): T | undefined {
		return this._contributionInstances.get(ctor as IConstructorSignature<BrowserEditorContribution, [BrowserEditor]>) as T | undefined;
	}

	getContributions(): Iterable<BrowserEditorContribution> {
		return this._contributionInstances.values();
	}


	private _model: IBrowserViewModel | undefined;
	get model(): IBrowserViewModel | undefined { return this._model; }
	private readonly _onDidChangeModel = this._register(new Emitter<{
		model: IBrowserViewModel | undefined;
		isNew: boolean;
	}>());
	readonly onDidChangeModel = this._onDidChangeModel.event;


	private _browserContainerWrapper!: HTMLElement;
	private _browserContainer!: HTMLElement;
	get browserContainer(): HTMLElement { return this._browserContainer; }

	private _hasUrlContext!: IContextKey<boolean>;
	private _hasErrorContext!: IContextKey<boolean>;

	private readonly _inputDisposables = this._register(new DisposableStore());
	private _currentPadding: { top: number; right: number; bottom: number; left: number } = { top: 0, right: 0, bottom: 0, left: 0 };

	override get input(): BrowserEditorInput | undefined { return super.input as BrowserEditorInput | undefined; }

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@ILayoutService private readonly layoutService: ILayoutService,
	) {
		super(BrowserEditorInput.EDITOR_ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		const contextKeyService = this._register(this.contextKeyService.createScoped(parent));

		this._hasUrlContext = CONTEXT_BROWSER_HAS_URL.bindTo(contextKeyService);
		this._hasErrorContext = CONTEXT_BROWSER_HAS_ERROR.bindTo(contextKeyService);

		CONTEXT_BROWSER_FOCUSED.bindTo(contextKeyService);

		const scopedInstantiationService = this._register(this.instantiationService.createChild(
			new ServiceCollection([IContextKeyService, contextKeyService])
		));

		for (const ctor of BrowserEditor._contributions) {
			const instance = this._register(scopedInstantiationService.createInstance(ctor, this));
			this._contributionInstances.set(ctor, instance);
		}

		const root = $('.browser-root');
		root.tabIndex = -1;
		parent.appendChild(root);

		const widgetsByLocation = new Map<BrowserWidgetLocation, IBrowserEditorWidget[]>();
		for (const contribution of this._contributionInstances.values()) {
			for (const widget of contribution.widgets) {
				let bucket = widgetsByLocation.get(widget.location);
				if (!bucket) {
					bucket = [];
					widgetsByLocation.set(widget.location, bucket);
				}
				bucket.push(widget);
			}
		}
		for (const bucket of widgetsByLocation.values()) {
			bucket.sort((a, b) => a.order - b.order);
		}
		const widgetsAt = (location: BrowserWidgetLocation): readonly IBrowserEditorWidget[] =>
			widgetsByLocation.get(location) ?? [];

		for (const widget of widgetsAt(BrowserWidgetLocation.Toolbar)) {
			root.appendChild(widget.element);
		}

		this._browserContainerWrapper = $('.browser-container-wrapper');
		this._browserContainerWrapper.style.setProperty('--zoom-factor', String(getZoomFactor(this.window)));
		root.appendChild(this._browserContainerWrapper);

		this._browserContainer = $('.browser-container');
		this._browserContainer.tabIndex = 0;
		this._browserContainerWrapper.appendChild(this._browserContainer);

		for (const contribution of this._contributionInstances.values()) {
			contribution.onContainerCreated(this._browserContainer);
		}

		const placeholderContents = $('.browser-placeholder-contents');
		this._browserContainer.appendChild(placeholderContents);

		for (const widget of widgetsAt(BrowserWidgetLocation.ContentArea)) {
			placeholderContents.appendChild(widget.element);
		}
	}

	override focus(): void {
		for (const c of this._contributionInstances.values()) {
			if (c.tryFocus()) {
				return;
			}
		}
		this.ensureBrowserFocus();
	}

	override async setInput(input: BrowserEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (token.isCancellationRequested) {
			return;
		}

		this._inputDisposables.clear();

		let model = input.model;
		const isNew = !model;
		if (!model) {
			this._hasUrlContext.set(!!input.url);
			this._hasErrorContext.set(false);

			for (const c of this._contributionInstances.values()) {
				c.prerenderInput(input);
			}

			model = await input.resolve();
		}

		if (token.isCancellationRequested || this.input !== input) {
			return;
		}

		this._model = model;
		this._onDidChangeModel.fire({ model, isNew });

		this._hasUrlContext.set(!!model.url);
		this._hasErrorContext.set(!!model.error);

		this._inputDisposables.add(this._model.onWillDispose(() => {
			if (this._model === model) {
				this._model = undefined;
				this._onDidChangeModel.fire({ model: undefined, isNew: false });
			}
		}));

		this._inputDisposables.add(this._model.onWillNavigate(() => {
			this.group.pinEditor(this.input);
			this.ensureBrowserFocus();
		}));

		this._inputDisposables.add(this._model.onDidNavigate(() => {
			this.group.pinEditor(this.input);
			this._hasUrlContext.set(!!model.url);
		}));

		this._inputDisposables.add(this._model.onDidChangeLoadingState(() => {
			this._hasErrorContext.set(!!model.error);
		}));

		this._inputDisposables.add(model.onDidChangeFocus(({ focused }) => {
			if (focused) {
				this._onDidFocus?.fire();
				this.ensureBrowserFocus();
			}
		}));

		this._inputDisposables.add(onDidChangeZoomLevel(targetWindowId => {
			if (targetWindowId === this.window.vscodeWindowId) {
				this._browserContainerWrapper.style.setProperty('--zoom-factor', String(getZoomFactor(this.window)));
				this.layoutBrowserContainer();
			}
		}));

		this.layout();
	}

	protected override setEditorVisible(visible: boolean): void {
		for (const c of this._contributionInstances.values()) {
			c.onPaneVisibilityChanged(visible);
		}
	}

	ensureBrowserFocus(): void {
		originalHtmlElementFocus.call(this._browserContainer);
		this.window.document.getSelection()?.removeAllRanges();
	}

	closeTab(): void {
		this.group?.closeEditor(this.input);
	}

	override layout(dimension?: Dimension, _position?: IDomPosition): void {
		if (dimension) {
			for (const contribution of this._contributionInstances.values()) {
				contribution.onPaneResized(dimension.width);
			}
		}

		const whenContainerStylesLoaded = this.layoutService.whenContainerStylesLoaded(this.window);
		if (whenContainerStylesLoaded) {
			whenContainerStylesLoaded.then(() => this.layoutBrowserContainer());
		} else {
			this.layoutBrowserContainer();
		}
	}

	layoutBrowserContainer(retries = 2): void {
		if (!this._model) {
			return;
		}

		const overrides: IContainerLayoutOverride[] = [];
		for (const c of this._contributionInstances.values()) {
			const o = c.beforeContainerLayout();
			if (o) {
				overrides.push(o);
			}
		}

		const padding = { top: 0, right: 0, bottom: 0, left: 0 };
		for (const o of overrides) {
			padding.top = Math.max(padding.top, o.padding?.top ?? 0);
			padding.right = Math.max(padding.right, o.padding?.right ?? 0);
			padding.bottom = Math.max(padding.bottom, o.padding?.bottom ?? 0);
			padding.left = Math.max(padding.left, o.padding?.left ?? 0);
		}
		this._currentPadding = padding;

		const wrapperRect = this._browserContainerWrapper.getBoundingClientRect();
		if ((wrapperRect.width === 0 || wrapperRect.height === 0) && retries > 0) {
			this.window.requestAnimationFrame(() => this.layoutBrowserContainer(retries - 1));
			return;
		}

		const paneWidth = Math.max(0, wrapperRect.width - padding.left - padding.right);
		const paneHeight = Math.max(0, wrapperRect.height - padding.top - padding.bottom);
		const pane: IContainerLayoutPane = {
			width: paneWidth,
			height: paneHeight,
			originX: wrapperRect.left + padding.left,
			originY: wrapperRect.top + padding.top,
		};
		const sorted = overrides.slice().sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
		let layout: IContainerLayout = { width: paneWidth, height: paneHeight, top: 0, left: 0 };
		for (const o of sorted) {
			const next = o.compute?.(layout, pane);
			if (next) {
				layout = next;
			}
		}

		const left = padding.left + (layout.left ?? 0);
		const top = padding.top + (layout.top ?? 0);

		this._browserContainer.style.width = `${layout.width}px`;
		this._browserContainer.style.height = `${layout.height}px`;
		this._browserContainer.style.left = `${left}px`;
		this._browserContainer.style.top = `${top}px`;

		const cornerRadius = parseFloat(this.window.getComputedStyle(this._browserContainer).borderTopLeftRadius ?? '0');
		void this._model.layout({
			windowId: this.group.windowId,
			x: wrapperRect.left + left,
			y: wrapperRect.top + top,
			width: layout.width,
			height: layout.height,
			zoomFactor: getZoomFactor(this.window),
			cornerRadius,
			emulation: layout.emulation,
		});

		for (const c of this._contributionInstances.values()) {
			c.afterContainerLayout();
		}
	}

	get paneSize(): { width: number; height: number } {
		const r = this._browserContainerWrapper.getBoundingClientRect();
		const p = this._currentPadding;
		return {
			width: Math.max(0, r.width - p.left - p.right),
			height: Math.max(0, r.height - p.top - p.bottom),
		};
	}

	override clearInput(): void {
		this._inputDisposables.clear();

		if (this._model) {
			this._model = undefined;
			this._onDidChangeModel.fire({ model: undefined, isNew: false });
		}

		this._hasUrlContext.reset();
		this._hasErrorContext.reset();

		super.clearInput();
	}
}

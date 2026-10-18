/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMouseWheelEvent } from '../../../../base/browser/mouseEvent.js';
import { CodeWindow } from '../../../../base/browser/window.js';
import { equals } from '../../../../base/common/arrays.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IObservable } from '../../../../base/common/observable.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWebviewPortMapping } from '../../../../platform/webview/common/webviewPortMapping.js';
import { Memento } from '../../../common/memento.js';

export const KEYBINDING_CONTEXT_WEBVIEW_FIND_WIDGET_VISIBLE = new RawContextKey<boolean>('webviewFindWidgetVisible', false);

export const KEYBINDING_CONTEXT_WEBVIEW_FIND_WIDGET_FOCUSED = new RawContextKey<boolean>('webviewFindWidgetFocused', false);

export const KEYBINDING_CONTEXT_WEBVIEW_FIND_WIDGET_ENABLED = new RawContextKey<boolean>('webviewFindWidgetEnabled', false);

export const IWebviewService = createDecorator<IWebviewService>('webviewService');

export interface IWebviewService {
	readonly _serviceBrand: undefined;

	readonly activeWebview: IWebview | undefined;

	readonly webviews: Iterable<IWebview>;

	readonly onDidChangeActiveWebview: Event<IWebview | undefined>;

	createWebviewElement(initInfo: WebviewInitInfo): IWebviewElement;

	createWebviewOverlay(initInfo: WebviewInitInfo): IOverlayWebview;
}

export interface WebviewInitInfo {
	readonly providedViewType?: string;
	readonly origin?: string;

	readonly title: string | undefined;

	readonly options: WebviewOptions;
	readonly contentOptions: WebviewContentOptions;

	readonly extension: WebviewExtensionDescription | undefined;
}

export const enum WebviewContentPurpose {
	NotebookRenderer = 'notebookRenderer',
	CustomEditor = 'customEditor',
	WebviewView = 'webviewView',
	ChatOutputItem = 'chatOutputItem',
}

export type WebviewStyles = { readonly [key: string]: string | number };

export interface WebviewOptions {
	readonly purpose?: WebviewContentPurpose;
	readonly customClasses?: string;
	readonly enableFindWidget?: boolean;

	readonly disableServiceWorker?: boolean;

	readonly tryRestoreScrollPosition?: boolean;
	readonly retainContextWhenHidden?: boolean;
	transformCssVariables?(styles: WebviewStyles): WebviewStyles;
}

export interface WebviewContentOptions {
	readonly allowMultipleAPIAcquire?: boolean;

	readonly allowScripts?: boolean;

	readonly allowForms?: boolean;

	readonly forwardUntrustedKeypressEvents?: boolean;

	readonly localResourceRoots?: readonly URI[];

	readonly portMapping?: readonly IWebviewPortMapping[];

	readonly enableCommandUris?: boolean | readonly string[];
}

export function areWebviewContentOptionsEqual(a: WebviewContentOptions, b: WebviewContentOptions): boolean {
	return (
		a.allowMultipleAPIAcquire === b.allowMultipleAPIAcquire
		&& a.allowScripts === b.allowScripts
		&& a.allowForms === b.allowForms
		&& a.forwardUntrustedKeypressEvents === b.forwardUntrustedKeypressEvents
		&& equals(a.localResourceRoots, b.localResourceRoots, isEqual)
		&& equals(a.portMapping, b.portMapping, (a, b) => a.extensionHostPort === b.extensionHostPort && a.webviewPort === b.webviewPort)
		&& areEnableCommandUrisEqual(a, b)
	);
}

function areEnableCommandUrisEqual(a: WebviewContentOptions, b: WebviewContentOptions): boolean {
	if (a.enableCommandUris === b.enableCommandUris) {
		return true;
	}

	if (Array.isArray(a.enableCommandUris) && Array.isArray(b.enableCommandUris)) {
		return equals(a.enableCommandUris, b.enableCommandUris);
	}

	return false;
}

export interface WebviewExtensionDescription {
	readonly location?: URI;
	readonly id: ExtensionIdentifier;
}

export interface WebviewMessageReceivedEvent {
	readonly message: any;
	readonly transfer?: readonly ArrayBuffer[];
}

export interface IWebview extends IDisposable {

	readonly providedViewType?: string;

	readonly origin: string;

	setHtml(html: string): void;

	setTitle(title: string): void;

	contentOptions: WebviewContentOptions;

	localResourcesRoot: readonly URI[];

	extension: WebviewExtensionDescription | undefined;

	initialScrollProgress: number;
	state: string | undefined;

	readonly isFocused: boolean;

	readonly onDidFocus: Event<void>;
	readonly onDidBlur: Event<void>;

	readonly onDidDispose: Event<void>;

	readonly onDidClickLink: Event<string>;
	readonly onDidScroll: Event<{ readonly scrollYPercentage: number }>;
	readonly onDidWheel: Event<IMouseWheelEvent>;

	readonly onDidUpdateState: Event<string | undefined>;

	readonly intrinsicContentSize: IObservable<{ readonly width: number; readonly height: number } | undefined>;

	readonly onFatalError: Event<{ readonly message: string }>;
	readonly onMissingCsp: Event<ExtensionIdentifier>;

	readonly onMessage: Event<WebviewMessageReceivedEvent>;

	postMessage(message: any, transfer?: readonly ArrayBuffer[]): Promise<boolean>;

	focus(): void;
	reload(): void;

	showFind(animated?: boolean): void;
	hideFind(animated?: boolean): void;
	runFindAction(previous: boolean): void;

	selectAll(): void;
	copy(): void;
	paste(): void;
	cut(): void;
	undo(): void;
	redo(): void;

	windowDidDragStart(): void;
	windowDidDragEnd(): void;

	setContextKeyService(scopedContextKeyService: IContextKeyService): void;
}

export interface IWebviewElement extends IWebview {
	mountTo(parent: HTMLElement, targetWindow: CodeWindow): void;

	reinitializeAfterDismount(): void;
}

export interface IOverlayWebview extends IWebview {
	readonly container: HTMLElement;

	origin: string;

	options: WebviewOptions;

	claim(claimant: any, targetWindow: CodeWindow, scopedContextKeyService: IContextKeyService | undefined): void;

	release(claimant: any): void;

	setAnchorElement(element: HTMLElement, clippingContainer?: HTMLElement): void;
}

export class WebviewOriginStore {

	private readonly _memento: Memento<Record<string, string>>;
	private readonly _state: Record<string, string | undefined>;

	constructor(
		rootStorageKey: string,
		@IStorageService storageService: IStorageService,
	) {
		this._memento = new Memento(rootStorageKey, storageService);
		this._state = this._memento.getMemento(StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	public getOrigin(viewType: string, additionalKey: string | undefined): string {
		const key = this._getKey(viewType, additionalKey);

		const existing = this._state[key];
		if (existing && typeof existing === 'string') {
			return existing;
		}

		const newOrigin = generateUuid();
		this._state[key] = newOrigin;
		this._memento.saveMemento();
		return newOrigin;
	}

	private _getKey(viewType: string, additionalKey: string | undefined): string {
		return JSON.stringify({ viewType, key: additionalKey });
	}
}

export class ExtensionKeyedWebviewOriginStore {

	private readonly _store: WebviewOriginStore;

	constructor(
		rootStorageKey: string,
		@IStorageService storageService: IStorageService,
	) {
		this._store = new WebviewOriginStore(rootStorageKey, storageService);
	}

	public getOrigin(viewType: string, extId: ExtensionIdentifier): string {
		return this._store.getOrigin(viewType, extId.value);
	}
}

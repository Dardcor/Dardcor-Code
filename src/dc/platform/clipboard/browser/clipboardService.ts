/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isSafari, isWebkitWebView } from '../../../base/browser/browser.js';
import { $, addDisposableListener, getActiveDocument, getActiveWindow, isHTMLElement, onDidRegisterWindow } from '../../../base/browser/dom.js';
import { mainWindow } from '../../../base/browser/window.js';
import { DeferredPromise } from '../../../base/common/async.js';
import { Event } from '../../../base/common/event.js';
import { hash } from '../../../base/common/hash.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { IClipboardService } from '../common/clipboardService.js';
import { ILayoutService } from '../../layout/browser/layoutService.js';
import { ILogService } from '../../log/common/log.js';

const vscodeResourcesMime = 'application/vnd.code.resources';

export class BrowserClipboardService extends Disposable implements IClipboardService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@ILayoutService private readonly layoutService: ILayoutService,
		@ILogService protected readonly logService: ILogService
	) {
		super();

		if (isSafari || isWebkitWebView) {
			this.installWebKitWriteTextWorkaround();
		}

		this._register(Event.runAndSubscribe(onDidRegisterWindow, ({ window, disposables }) => {
			disposables.add(addDisposableListener(window.document, 'copy', () => this.clearResourcesState()));
		}, { window: mainWindow, disposables: this._store }));
	}

	triggerPaste(): Promise<void> | undefined {
		this.logService.trace('BrowserClipboardService#triggerPaste');
		return undefined;
	}

	async readImage(): Promise<Uint8Array> {
		try {
			const clipboardItems = await navigator.clipboard.read();
			const clipboardItem = clipboardItems[0];

			const supportedImageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/tiff', 'image/bmp'];
			const mimeType = supportedImageTypes.find(type => clipboardItem.types.includes(type));

			if (mimeType) {
				const blob = await clipboardItem.getType(mimeType);
				const buffer = await blob.arrayBuffer();
				return new Uint8Array(buffer);
			} else {
				console.error('No supported image type found in the clipboard');
			}
		} catch (error) {
			console.error('Error reading image from clipboard:', error);
		}

		return new Uint8Array(0);
	}

	private webKitPendingClipboardWritePromise: DeferredPromise<string> | undefined;

	private installWebKitWriteTextWorkaround(): void {
		const handler = () => {
			const currentWritePromise = new DeferredPromise<string>();

			if (this.webKitPendingClipboardWritePromise && !this.webKitPendingClipboardWritePromise.isSettled) {
				this.webKitPendingClipboardWritePromise.cancel();
			}
			this.webKitPendingClipboardWritePromise = currentWritePromise;

			getActiveWindow().navigator.clipboard.write([new ClipboardItem({
				'text/plain': currentWritePromise.p,
			})]).catch(async err => {
				if (!(err instanceof Error) || err.name !== 'NotAllowedError' || !currentWritePromise.isRejected) {
					this.logService.error(err);
				}
			});
		};


		this._register(Event.runAndSubscribe(this.layoutService.onDidAddContainer, ({ container, disposables }) => {
			disposables.add(addDisposableListener(container, 'click', handler));
			disposables.add(addDisposableListener(container, 'keydown', handler));
		}, { container: this.layoutService.mainContainer, disposables: this._store }));
	}

	private readonly mapTextToType = new Map<string, string>();

	async writeText(text: string, type?: string): Promise<void> {
		this.logService.trace('BrowserClipboardService#writeText called with type:', type, ' text.length:', text.length);
		this.clearResourcesState();

		if (type) {
			this.mapTextToType.set(type, text);
			this.logService.trace('BrowserClipboardService#writeText');
			return;
		}

		if (this.webKitPendingClipboardWritePromise) {
			return this.webKitPendingClipboardWritePromise.complete(text);
		}

		try {
			this.logService.trace('before navigator.clipboard.writeText');
			return await getActiveWindow().navigator.clipboard.writeText(text);
		} catch (error) {
			console.error(error);
		}

		this.fallbackWriteText(text);
	}

	private fallbackWriteText(text: string): void {
		this.logService.trace('BrowserClipboardService#fallbackWriteText');
		const activeDocument = getActiveDocument();
		const activeElement = activeDocument.activeElement;

		const textArea: HTMLTextAreaElement = activeDocument.body.appendChild($('textarea', { 'aria-hidden': true }));
		textArea.style.height = '1px';
		textArea.style.width = '1px';
		textArea.style.position = 'absolute';

		textArea.value = text;
		textArea.focus();
		textArea.select();

		activeDocument.execCommand('copy');

		if (isHTMLElement(activeElement)) {
			activeElement.focus();
		}

		textArea.remove();
	}

	async readText(type?: string): Promise<string> {
		this.logService.trace('BrowserClipboardService#readText called with type:', type);
		if (type) {
			const readText = this.mapTextToType.get(type) || '';
			this.logService.trace('BrowserClipboardService#readText text.length:', readText.length);
			return readText;
		}

		try {
			const readText = await getActiveWindow().navigator.clipboard.readText();
			this.logService.trace('BrowserClipboardService#readText text.length:', readText.length);
			return readText;
		} catch (error) {
			console.error(error);
		}

		return '';
	}

	private findText = '';

	async readFindText(): Promise<string> {
		return this.findText;
	}

	async writeFindText(text: string): Promise<void> {
		this.findText = text;
	}

	private resources: URI[] = [];
	private resourcesStateHash: number | undefined = undefined;

	private static readonly MAX_RESOURCE_STATE_SOURCE_LENGTH = 1000;

	async writeResources(resources: URI[]): Promise<void> {
		try {
			await getActiveWindow().navigator.clipboard.write([
				new ClipboardItem({
					[`web ${vscodeResourcesMime}`]: new Blob([
						JSON.stringify(resources.map(x => x.toJSON()))
					], {
						type: vscodeResourcesMime
					})
				})
			]);

		} catch (error) {
		}

		if (resources.length === 0) {
			this.clearResourcesState();
		} else {
			this.resources = resources;
			this.resourcesStateHash = await this.computeResourcesStateHash();
		}
	}

	async readResources(): Promise<URI[]> {
		try {
			const items = await getActiveWindow().navigator.clipboard.read();
			for (const item of items) {
				if (item.types.includes(`web ${vscodeResourcesMime}`)) {
					const blob = await item.getType(`web ${vscodeResourcesMime}`);
					const resources = (JSON.parse(await blob.text()) as URI[]).map(x => URI.from(x));
					return resources;
				}
			}
		} catch (error) {
		}

		const resourcesStateHash = await this.computeResourcesStateHash();
		if (this.resourcesStateHash !== resourcesStateHash) {
			this.clearResourcesState();
		}

		return this.resources;
	}

	private async computeResourcesStateHash(): Promise<number | undefined> {
		if (this.resources.length === 0) {
			return undefined;
		}


		const clipboardText = await this.readText();
		return hash(clipboardText.substring(0, BrowserClipboardService.MAX_RESOURCE_STATE_SOURCE_LENGTH));
	}

	async hasResources(): Promise<boolean> {
		try {
			const items = await getActiveWindow().navigator.clipboard.read();
			for (const item of items) {
				if (item.types.includes(`web ${vscodeResourcesMime}`)) {
					return true;
				}
			}
		} catch (error) {
		}

		return this.resources.length > 0;
	}

	public clearInternalState(): void {
		this.clearResourcesState();
	}

	private clearResourcesState(): void {
		this.resources = [];
		this.resourcesStateHash = undefined;
	}
}

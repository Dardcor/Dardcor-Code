/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BrowserOverlayManager, BrowserOverlayType } from '../../electron-browser/overlayManager.js';

suite('BrowserOverlayManager', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let manager: BrowserOverlayManager;
	let elements: HTMLElement[];

	function addElement(className: string, styles: Partial<CSSStyleDeclaration>, parent: HTMLElement = mainWindow.document.body): HTMLElement {
		const el = $(`.${className}`);
		Object.assign(el.style, styles);
		parent.appendChild(el);
		elements.push(el);
		return el;
	}

	setup(() => {
		elements = [];
		manager = store.add(new BrowserOverlayManager(mainWindow));
	});

	teardown(() => {
		for (const el of elements) {
			el.remove();
		}
		elements = [];
	});

	test('detects a modal overlay covering the browser container', () => {
		const browserContainer = addElement('browser-container', {
			position: 'absolute', left: '0px', top: '0px', width: '300px', height: '300px'
		});
		addElement('monaco-modal-editor-block', {
			position: 'fixed', left: '0px', top: '0px', width: '400px', height: '400px', zIndex: '2540'
		});

		const overlays = manager.getOverlappingOverlays(browserContainer);

		assert.deepStrictEqual(overlays.map(o => o.type), [BrowserOverlayType.Dialog]);
	});

	test('does not detect an overlay that does not overlap the browser container', () => {
		const browserContainer = addElement('browser-container', {
			position: 'absolute', left: '0px', top: '0px', width: '100px', height: '100px'
		});
		addElement('monaco-menu-container', {
			position: 'fixed', left: '500px', top: '500px', width: '100px', height: '100px', zIndex: '2575'
		});

		const overlays = manager.getOverlappingOverlays(browserContainer);

		assert.deepStrictEqual(overlays, []);
	});

	test('detects an overlay beneath detached webview content', () => {
		const browserContainer = addElement('browser-container', {
			position: 'absolute', left: '0px', top: '0px', width: '300px', height: '300px'
		});
		const contextView = addElement('context-view', {
			position: 'fixed', left: '0px', top: '0px', width: '200px', height: '200px'
		});
		addElement('overlay-anchor', {
			position: 'absolute', left: '0px', top: '0px', width: '200px', height: '200px'
		}, contextView);

		const overlayContent = addElement('webview-overlay-content', {
			position: 'fixed', left: '0px', top: '0px', width: '200px', height: '200px', zIndex: '1'
		});
		addElement('webview', {
			width: '100%', height: '100%'
		}, overlayContent);

		const overlays = manager.getOverlappingOverlays(browserContainer);

		assert.deepStrictEqual(overlays.map(o => o.type), [BrowserOverlayType.Unknown]);
	});

	test('detects obscuring when a context-view block covers the browser on top of a modal', () => {
		const browserContainer = addElement('browser-container', {
			position: 'absolute', left: '0px', top: '0px', width: '300px', height: '300px'
		});

		addElement('monaco-modal-editor-block', {
			position: 'fixed', left: '0px', top: '0px', width: '400px', height: '400px', zIndex: '2540'
		});

		const contextView = addElement('context-view', {
			position: 'fixed', left: '320px', top: '320px', width: '60px', height: '60px', zIndex: '2575'
		});
		addElement('context-view-block', {
			position: 'fixed', left: '0px', top: '0px', width: '400px', height: '400px', zIndex: '-1'
		}, contextView);

		const overlays = manager.getOverlappingOverlays(browserContainer);

		assert.deepStrictEqual(overlays.map(o => o.type), [BrowserOverlayType.Dialog]);
	});

	test('detects obscuring when a context-view pointer block covers the browser on top of a modal', () => {
		const browserContainer = addElement('browser-container', {
			position: 'absolute', left: '0px', top: '0px', width: '300px', height: '300px'
		});

		addElement('monaco-modal-editor-block', {
			position: 'fixed', left: '0px', top: '0px', width: '400px', height: '400px', zIndex: '2540'
		});

		const contextView = addElement('context-view', {
			position: 'fixed', left: '320px', top: '320px', width: '60px', height: '60px', zIndex: '2575'
		});
		addElement('context-view-pointerBlock', {
			position: 'fixed', left: '0px', top: '0px', width: '400px', height: '400px', zIndex: '2'
		}, contextView);

		const overlays = manager.getOverlappingOverlays(browserContainer);

		assert.deepStrictEqual(overlays.map(o => o.type), [BrowserOverlayType.Dialog]);
	});

	test('reports the dialog, not a notification covered by it', () => {
		const browserContainer = addElement('browser-container', {
			position: 'absolute', left: '0px', top: '0px', width: '300px', height: '300px'
		});
		addElement('notification-toast-container', {
			position: 'fixed', left: '0px', top: '0px', width: '200px', height: '200px', zIndex: '2000'
		});
		addElement('monaco-modal-editor-block', {
			position: 'fixed', left: '0px', top: '0px', width: '400px', height: '400px', zIndex: '2540'
		});

		const overlays = manager.getOverlappingOverlays(browserContainer);

		assert.deepStrictEqual(overlays.map(o => o.type), [BrowserOverlayType.Dialog]);
	});
});

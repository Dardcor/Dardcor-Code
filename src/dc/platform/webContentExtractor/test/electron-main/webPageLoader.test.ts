/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { runWithFakedTimers } from '../../../../base/test/common/timeTravelScheduler.js';
import { NullLogService } from '../../../log/common/log.js';
import { IAgentNetworkFilterService } from '../../../networkFilter/common/networkFilterService.js';
import { AXNode } from '../../electron-main/cdpAccessibilityDomain.js';
import { WebPageLoader } from '../../electron-main/webPageLoader.js';
import { IWebContentExtractorOptions } from '../../common/webContentExtractor.js';

interface MockElectronEvent {
	preventDefault?: sinon.SinonStub;
}

class MockWebContents {
	private readonly _listeners = new Map<string, ((...args: unknown[]) => void)[]>();
	private readonly _onceListeners = new Set<(...args: unknown[]) => void>();
	public readonly debugger: MockDebugger;
	public loadURL = sinon.stub().resolves();
	public getTitle = sinon.stub().returns('Test Page Title');
	public executeJavaScript = sinon.stub().resolves(undefined);

	public session = {
		webRequest: {
			onBeforeSendHeaders: sinon.stub(),
			onHeadersReceived: sinon.stub()
		},
		on: sinon.stub()
	};

	constructor() {
		this.debugger = new MockDebugger();
	}

	once(event: string, listener: (...args: unknown[]) => void): this {
		if (!this._listeners.has(event)) {
			this._listeners.set(event, []);
		}
		this._listeners.get(event)!.push(listener);
		this._onceListeners.add(listener);
		return this;
	}

	on(event: string, listener: (...args: unknown[]) => void): this {
		if (!this._listeners.has(event)) {
			this._listeners.set(event, []);
		}
		this._listeners.get(event)!.push(listener);
		return this;
	}

	emit(event: string, ...args: unknown[]): void {
		const listeners = this._listeners.get(event) || [];
		for (const listener of listeners) {
			listener(...args);
		}
		const remaining = listeners.filter(l => !this._onceListeners.has(l));
		for (const listener of listeners) {
			this._onceListeners.delete(listener);
		}
		if (remaining.length > 0) {
			this._listeners.set(event, remaining);
		} else {
			this._listeners.delete(event);
		}
	}

	beginFrameSubscription(_onlyDirty: boolean, callback: () => void): void {
		setTimeout(() => callback(), 0);
	}

	endFrameSubscription(): void {
	}
}

class MockDebugger {
	private readonly _listeners = new Map<string, ((...args: unknown[]) => void)[]>();
	public attach = sinon.stub();
	public sendCommand = sinon.stub().resolves({});

	on(event: string, listener: (...args: unknown[]) => void): this {
		if (!this._listeners.has(event)) {
			this._listeners.set(event, []);
		}
		this._listeners.get(event)!.push(listener);
		return this;
	}

	emit(event: string, ...args: unknown[]): void {
		const listeners = this._listeners.get(event) || [];
		for (const listener of listeners) {
			listener(...args);
		}
	}
}

class MockBrowserWindow {
	public readonly webContents: MockWebContents;
	public destroy = sinon.stub();
	public loadURL = sinon.stub().resolves();

	constructor(_options?: Electron.BrowserWindowConstructorOptions) {
		this.webContents = new MockWebContents();
	}
}

suite('WebPageLoader', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let window: MockBrowserWindow;

	teardown(() => {
		sinon.restore();
	});

	function createWebPageLoader(uri: URI, options?: IWebContentExtractorOptions, isTrustedDomain?: (uri: URI) => boolean, isDomainAllowed?: (uri: URI) => boolean): WebPageLoader {
		const agentNetworkFilterService: IAgentNetworkFilterService = {
			_serviceBrand: undefined,
			onDidChange: Event.None,
			isEnabled: () => true,
			isUriAllowed: isDomainAllowed ?? (() => true),
			formatError: (u) => `Access to ${u.authority} is blocked by network domain policy.`,
		};
		const loader = new WebPageLoader((options) => {
			window = new MockBrowserWindow(options);
			// eslint-disable-next-line local/code-no-any-casts
			return window as any;
		}, new NullLogService(), uri, options, isTrustedDomain ?? (() => false), agentNetworkFilterService);
		disposables.add(loader);
		return loader;
	}

	function createMockAXNodes(): AXNode[] {
		return [
			{
				nodeId: 'node1',
				ignored: false,
				role: { type: 'role', value: 'paragraph' },
				childIds: ['node2']
			},
			{
				nodeId: 'node2',
				ignored: false,
				role: { type: 'role', value: 'StaticText' },
				name: { type: 'string', value: 'Test content from page' }
			}
		];
	}

	interface DebuggerMockOptions {
		axNodes?: AXNode[] | ((frameId: string) => AXNode[]);
		frameTree?: { frame: { id: string; url?: string }; childFrames?: unknown[] };
		accessibilityHang?: boolean;
	}

	function setupDebuggerMock(options: DebuggerMockOptions = {}): void {
		const {
			axNodes = createMockAXNodes(),
			frameTree = { frame: { id: 'main-frame' }, childFrames: [] },
			accessibilityHang
		} = options;

		window.webContents.debugger.sendCommand.callsFake((command: string, params?: { frameId?: string }) => {
			switch (command) {
				case 'Network.enable':
					return Promise.resolve();
				case 'Page.enable':
					return Promise.resolve();
				case 'Page.getFrameTree':
					return Promise.resolve({ frameTree });
				case 'Accessibility.getFullAXTree':
					if (accessibilityHang) {
						return new Promise(() => { });
					} else if (typeof axNodes === 'function') {
						return Promise.resolve({ nodes: axNodes(params?.frameId ?? '') });
					} else {
						return Promise.resolve({ nodes: axNodes });
					}
				default:
					assert.fail(`Unexpected command: ${command}`);
			}
		});
	}


	test('successful page load returns ok status with content', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://example.com/page');

		const loader = createWebPageLoader(uri);
		setupDebuggerMock();

		const loadPromise = loader.load();

		window.webContents.emit('did-start-loading');
		window.webContents.emit('did-finish-load');

		const result = await loadPromise;

		assert.strictEqual(result.status, 'ok');
		assert.strictEqual(result.title, 'Test Page Title');
		assert.ok(result.result.includes('Test content from page'));
	}));

	test('page load failure returns error status', async () => {
		const uri = URI.parse('https://example.com/page');

		const loader = createWebPageLoader(uri);
		setupDebuggerMock();

		const loadPromise = loader.load();

		const mockEvent: MockElectronEvent = {};
		window.webContents.emit('did-fail-load', mockEvent, -6, 'ERR_CONNECTION_REFUSED');

		const result = await loadPromise;

		assert.strictEqual(result.status, 'error');
		if (result.status === 'error') {
			assert.strictEqual(result.statusCode, -6);
			assert.strictEqual(result.error, 'ERR_CONNECTION_REFUSED');
		}
	});

	test('ERR_ABORTED is ignored and content extraction continues', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://example.com/page');

		const loader = createWebPageLoader(uri);
		setupDebuggerMock();

		const loadPromise = loader.load();

		const mockEvent: MockElectronEvent = {};
		window.webContents.emit('did-fail-load', mockEvent, -3, 'ERR_ABORTED');

		const result = await loadPromise;

		assert.strictEqual(result.status, 'ok');
		if (result.status === 'ok') {
			assert.ok(result.result.includes('Test content from page'));
		}
	}));

	test('ERR_BLOCKED_BY_CLIENT is ignored and content extraction continues', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://example.com/page');

		const loader = createWebPageLoader(uri);
		setupDebuggerMock();

		const loadPromise = loader.load();

		const mockEvent: MockElectronEvent = {};
		window.webContents.emit('did-fail-load', mockEvent, -27, 'ERR_BLOCKED_BY_CLIENT');

		const result = await loadPromise;

		assert.strictEqual(result.status, 'ok');
		if (result.status === 'ok') {
			assert.ok(result.result.includes('Test content from page'));
		}
	}));



	test('redirect to different authority returns redirect status when followRedirects is false', async () => {
		const uri = URI.parse('https://example.com/page');
		const redirectUrl = 'https://other-domain.com/redirected';

		const loader = createWebPageLoader(uri, { followRedirects: false });

		window.webContents.debugger.sendCommand.resolves({});

		const loadPromise = loader.load();

		const mockEvent: MockElectronEvent = {
			preventDefault: sinon.stub()
		};
		window.webContents.emit('will-redirect', mockEvent, redirectUrl);

		const result = await loadPromise;

		assert.strictEqual(result.status, 'redirect');
		if (result.status === 'redirect') {
			assert.strictEqual(result.toURI.authority, 'other-domain.com');
		}
		assert.ok((mockEvent.preventDefault!).called);
	});

	test('redirect to same authority is not treated as redirect', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://example.com/page');
		const redirectUrl = 'https://example.com/other-page';

		const loader = createWebPageLoader(uri, { followRedirects: false });
		setupDebuggerMock();

		const loadPromise = loader.load();

		const mockEvent: MockElectronEvent = {
			preventDefault: sinon.stub()
		};
		window.webContents.emit('will-redirect', mockEvent, redirectUrl);

		assert.ok(!(mockEvent.preventDefault!).called);

		window.webContents.emit('did-start-loading');
		window.webContents.emit('did-finish-load');

		const result = await loadPromise;
		assert.strictEqual(result.status, 'ok');
	}));

	test('redirect is followed when followRedirects option is true', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://example.com/page');
		const redirectUrl = 'https://other-domain.com/redirected';

		const loader = createWebPageLoader(uri, { followRedirects: true });
		setupDebuggerMock();

		const loadPromise = loader.load();

		const mockEvent: MockElectronEvent = {
			preventDefault: sinon.stub()
		};
		window.webContents.emit('will-redirect', mockEvent, redirectUrl);

		assert.ok(!(mockEvent.preventDefault!).called);

		window.webContents.emit('did-start-loading');
		window.webContents.emit('did-finish-load');

		const result = await loadPromise;
		assert.strictEqual(result.status, 'ok');
	}));

	test('redirect from www to non-www same domain is allowed', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://www.example.com/page');
		const redirectUrl = 'https://example.com/other-page';

		const loader = createWebPageLoader(uri, { followRedirects: false });
		setupDebuggerMock();

		const loadPromise = loader.load();

		const mockEvent: MockElectronEvent = {
			preventDefault: sinon.stub()
		};
		window.webContents.emit('will-redirect', mockEvent, redirectUrl);

		assert.ok(!(mockEvent.preventDefault!).called);

		window.webContents.emit('did-start-loading');
		window.webContents.emit('did-finish-load');

		const result = await loadPromise;
		assert.strictEqual(result.status, 'ok');
	}));

	test('redirect from non-www to www same domain is allowed', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://example.com/page');
		const redirectUrl = 'https://www.example.com/other-page';

		const loader = createWebPageLoader(uri, { followRedirects: false });
		setupDebuggerMock();

		const loadPromise = loader.load();

		const mockEvent: MockElectronEvent = {
			preventDefault: sinon.stub()
		};
		window.webContents.emit('will-redirect', mockEvent, redirectUrl);

		assert.ok(!(mockEvent.preventDefault!).called);

		window.webContents.emit('did-start-loading');
		window.webContents.emit('did-finish-load');

		const result = await loadPromise;
		assert.strictEqual(result.status, 'ok');
	}));

	test('redirect to trusted domain is allowed', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://example.com/page');
		const redirectUrl = 'https://trusted-domain.com/redirected';

		const loader = createWebPageLoader(uri,
			{ followRedirects: false },
			(uri) => uri.authority === 'trusted-domain.com' || uri.authority === 'another-trusted.com'
		);
		setupDebuggerMock();

		const loadPromise = loader.load();

		const mockEvent: MockElectronEvent = {
			preventDefault: sinon.stub()
		};
		window.webContents.emit('will-redirect', mockEvent, redirectUrl);

		assert.ok(!(mockEvent.preventDefault!).called);

		window.webContents.emit('did-start-loading');
		window.webContents.emit('did-finish-load');

		const result = await loadPromise;
		assert.strictEqual(result.status, 'ok');
	}));

	test('post-load navigation to different domain is blocked silently and content is extracted', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://example.com/page');
		const adRedirectUrl = 'https://eus.rubiconproject.com/usync.html?p=12776';

		const loader = createWebPageLoader(uri, { followRedirects: false });
		setupDebuggerMock();

		const loadPromise = loader.load();

		window.webContents.emit('did-start-loading');
		window.webContents.emit('did-finish-load');

		const mockEvent: MockElectronEvent = {
			preventDefault: sinon.stub()
		};
		window.webContents.emit('will-navigate', mockEvent, adRedirectUrl);

		const result = await loadPromise;

		assert.ok((mockEvent.preventDefault!).called);
		assert.strictEqual(result.status, 'ok');
		assert.ok(result.result.includes('Test content from page'));
	}));

	test('initial same-domain navigation is allowed but later cross-domain navigation is blocked', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://example.com/page');
		const sameDomainUrl = 'https://example.com/otherpage';
		const crossDomainUrl = 'https://eus.rubiconproject.com/usync.html?p=12776';

		const loader = createWebPageLoader(uri, { followRedirects: false });
		setupDebuggerMock();

		const loadPromise = loader.load();

		const initialEvent: MockElectronEvent = {
			preventDefault: sinon.stub()
		};
		window.webContents.emit('will-navigate', initialEvent, sameDomainUrl);
		assert.ok(!(initialEvent.preventDefault!).called);

		window.webContents.emit('did-start-loading');
		window.webContents.emit('did-finish-load');

		const crossDomainEvent: MockElectronEvent = {
			preventDefault: sinon.stub()
		};
		window.webContents.emit('will-navigate', crossDomainEvent, crossDomainUrl);

		const result = await loadPromise;

		assert.ok((crossDomainEvent.preventDefault!).called);
		assert.strictEqual(result.status, 'ok');
		assert.ok(result.result.includes('Test content from page'));
	}));

	test('redirect to non-trusted domain is blocked', async () => {
		const uri = URI.parse('https://example.com/page');
		const redirectUrl = 'https://untrusted-domain.com/redirected';

		const loader = createWebPageLoader(uri,
			{ followRedirects: false },
			(uri) => uri.authority === 'trusted-domain.com'
		);

		window.webContents.debugger.sendCommand.resolves({});

		const loadPromise = loader.load();

		const mockEvent: MockElectronEvent = {
			preventDefault: sinon.stub()
		};
		window.webContents.emit('will-redirect', mockEvent, redirectUrl);

		const result = await loadPromise;

		assert.ok((mockEvent.preventDefault!).called);
		assert.strictEqual(result.status, 'redirect');
		if (result.status === 'redirect') {
			assert.strictEqual(result.toURI.authority, 'untrusted-domain.com');
		}
	});

	test('redirect to wildcard subdomain trusted domain is allowed', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://example.com/page');
		const redirectUrl = 'https://sub.trusted-domain.com/redirected';

		const loader = createWebPageLoader(uri,
			{ followRedirects: false },
			(uri) => uri.authority.endsWith('.trusted-domain.com') || uri.authority === 'trusted-domain.com'
		);
		setupDebuggerMock();

		const loadPromise = loader.load();

		const mockEvent: MockElectronEvent = {
			preventDefault: sinon.stub()
		};
		window.webContents.emit('will-redirect', mockEvent, redirectUrl);

		assert.ok(!(mockEvent.preventDefault!).called);

		window.webContents.emit('did-start-loading');
		window.webContents.emit('did-finish-load');

		const result = await loadPromise;
		assert.strictEqual(result.status, 'ok');
	}));

	test('navigation to domain blocked by isDomainAllowed returns error', async () => {
		const uri = URI.parse('https://example.com/page');
		const blockedUrl = 'https://blocked-domain.com/path';

		const loader = createWebPageLoader(uri, { followRedirects: true }, undefined, (u) => u.authority !== 'blocked-domain.com');

		window.webContents.debugger.sendCommand.resolves({});

		const loadPromise = loader.load();

		const mockEvent: MockElectronEvent = {
			preventDefault: sinon.stub()
		};
		window.webContents.emit('will-navigate', mockEvent, blockedUrl);

		const result = await loadPromise;

		assert.ok((mockEvent.preventDefault!).called);
		assert.strictEqual(result.status, 'error');
		if (result.status === 'error') {
			assert.ok(result.error?.includes('blocked-domain.com'));
		}
	});

	test('navigation to allowed domain is not blocked by isDomainAllowed', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://example.com/page');
		const allowedUrl = 'https://allowed-domain.com/path';

		const loader = createWebPageLoader(uri, { followRedirects: true }, undefined, (u) => u.authority !== 'blocked-domain.com');
		setupDebuggerMock();

		const loadPromise = loader.load();

		const mockEvent: MockElectronEvent = {
			preventDefault: sinon.stub()
		};
		window.webContents.emit('will-navigate', mockEvent, allowedUrl);

		assert.ok(!(mockEvent.preventDefault!).called);

		window.webContents.emit('did-start-loading');
		window.webContents.emit('did-finish-load');

		const result = await loadPromise;
		assert.strictEqual(result.status, 'ok');
	}));



	test('HTTP error status code returns error with content', async () => {
		const uri = URI.parse('https://example.com/not-found');

		const loader = createWebPageLoader(uri);
		setupDebuggerMock();

		const loadPromise = loader.load();

		const mockEvent: MockElectronEvent = {};
		window.webContents.debugger.emit('message', mockEvent, 'Network.responseReceived', {
			requestId: 'req1',
			type: 'Document',
			response: {
				status: 404,
				statusText: 'Not Found'
			}
		});

		const result = await loadPromise;

		assert.strictEqual(result.status, 'error');
		if (result.status === 'error') {
			assert.strictEqual(result.statusCode, 404);
			assert.strictEqual(result.error, 'Not Found');
		}
	});

	test('HTTP 500 error returns server error status', async () => {
		const uri = URI.parse('https://example.com/server-error');

		const loader = createWebPageLoader(uri);
		setupDebuggerMock();

		const loadPromise = loader.load();

		const mockEvent: MockElectronEvent = {};
		window.webContents.debugger.emit('message', mockEvent, 'Network.responseReceived', {
			requestId: 'req1',
			type: 'Document',
			response: {
				status: 500,
				statusText: 'Internal Server Error'
			}
		});

		const result = await loadPromise;

		assert.strictEqual(result.status, 'error');
		if (result.status === 'error') {
			assert.strictEqual(result.statusCode, 500);
			assert.strictEqual(result.error, 'Internal Server Error');
		}
	});

	test('HTTP error without status text uses fallback message', async () => {
		const uri = URI.parse('https://example.com/error');

		const loader = createWebPageLoader(uri);
		setupDebuggerMock();

		const loadPromise = loader.load();

		const mockEvent: MockElectronEvent = {};
		window.webContents.debugger.emit('message', mockEvent, 'Network.responseReceived', {
			requestId: 'req1',
			type: 'Document',
			response: {
				status: 503
			}
		});

		const result = await loadPromise;

		assert.strictEqual(result.status, 'error');
		if (result.status === 'error') {
			assert.strictEqual(result.statusCode, 503);
			assert.strictEqual(result.error, 'HTTP error 503');
		}
	});



	test('tracks network requests and waits for completion', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://example.com/page');

		const loader = createWebPageLoader(uri);
		setupDebuggerMock();

		const loadPromise = loader.load();

		window.webContents.emit('did-start-loading');

		const mockEvent: MockElectronEvent = {};
		window.webContents.debugger.emit('message', mockEvent, 'Network.requestWillBeSent', {
			requestId: 'req1'
		});
		window.webContents.debugger.emit('message', mockEvent, 'Network.requestWillBeSent', {
			requestId: 'req2'
		});

		window.webContents.emit('did-finish-load');

		window.webContents.debugger.emit('message', mockEvent, 'Network.loadingFinished', {
			requestId: 'req1'
		});
		window.webContents.debugger.emit('message', mockEvent, 'Network.loadingFinished', {
			requestId: 'req2'
		});

		const result = await loadPromise;

		assert.strictEqual(result.status, 'ok');
	}));

	test('handles network request failures gracefully', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://example.com/page');

		const loader = createWebPageLoader(uri);
		setupDebuggerMock();

		const loadPromise = loader.load();

		window.webContents.emit('did-start-loading');

		const mockEvent: MockElectronEvent = {};
		window.webContents.debugger.emit('message', mockEvent, 'Network.requestWillBeSent', {
			requestId: 'req1'
		});
		window.webContents.debugger.emit('message', mockEvent, 'Network.loadingFailed', {
			requestId: 'req1'
		});

		window.webContents.emit('did-finish-load');

		const result = await loadPromise;

		assert.strictEqual(result.status, 'ok');
	}));



	test('extracts content from accessibility tree', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://example.com/page');
		const axNodes: AXNode[] = [
			{
				nodeId: 'heading1',
				ignored: false,
				role: { type: 'role', value: 'heading' },
				name: { type: 'string', value: 'Page Title' },
				properties: [{ name: 'level', value: { type: 'integer', value: 1 } }],
				childIds: ['text1']
			},
			{
				nodeId: 'text1',
				ignored: false,
				role: { type: 'role', value: 'StaticText' },
				name: { type: 'string', value: 'Page Title' }
			}
		];

		const loader = createWebPageLoader(uri);
		setupDebuggerMock({ axNodes });

		const loadPromise = loader.load();

		window.webContents.emit('did-start-loading');
		window.webContents.emit('did-finish-load');

		const result = await loadPromise;

		assert.strictEqual(result.status, 'ok');
		if (result.status === 'ok') {
			assert.ok(result.result.includes('# Page Title'));
		}
	}));

	test('falls back to DOM extraction when accessibility tree yields insufficient content', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://example.com/page');
		const shortAXNodes: AXNode[] = [
			{
				nodeId: 'node1',
				ignored: false,
				role: { type: 'role', value: 'StaticText' },
				name: { type: 'string', value: 'Short' }
			}
		];

		const loader = createWebPageLoader(uri);
		setupDebuggerMock({ axNodes: shortAXNodes });

		const domContent = 'This is much longer content extracted from the DOM that exceeds the minimum content length requirement and should be used instead of the short accessibility tree content.';
		window.webContents.executeJavaScript.resolves(domContent);

		const loadPromise = loader.load();

		window.webContents.emit('did-start-loading');
		window.webContents.emit('did-finish-load');

		const result = await loadPromise;

		assert.strictEqual(result.status, 'ok');
		if (result.status === 'ok') {
			assert.strictEqual(result.result, domContent);
		}
		assert.ok(window.webContents.executeJavaScript.called);
	}));

	test('returns error when accessibility tree extraction hangs', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://example.com/page');
		const loader = createWebPageLoader(uri);
		setupDebuggerMock({ accessibilityHang: true });

		const loadPromise = loader.load();
		window.webContents.emit('did-start-loading');
		const result = await loadPromise;

		assert.strictEqual(result.status, 'error');
		if (result.status === 'error') {
			assert.ok(result.error.includes('Failed to extract meaningful content'));
		}
		assert.ok(!window.webContents.executeJavaScript.called);
	}));

	test('returns error when both accessibility tree and DOM extraction yield no content', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://example.com/empty-page');

		const loader = createWebPageLoader(uri);
		setupDebuggerMock({ axNodes: [] });

		window.webContents.executeJavaScript.resolves(undefined);

		const loadPromise = loader.load();

		window.webContents.emit('did-start-loading');
		window.webContents.emit('did-finish-load');

		const result = await loadPromise;

		assert.strictEqual(result.status, 'error');
		if (result.status === 'error') {
			assert.ok(result.error.includes('Failed to extract meaningful content'));
		}
		assert.ok(window.webContents.executeJavaScript.called);
	}));

	test('extracts content from multiple frames including iframes', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://example.com/page-with-iframes');

		const mainFrameNodes: AXNode[] = [
			{
				nodeId: 'main-root',
				ignored: false,
				role: { type: 'role', value: 'RootWebArea' },
				childIds: ['main-heading']
			},
			{
				nodeId: 'main-heading',
				ignored: false,
				role: { type: 'role', value: 'heading' },
				name: { type: 'string', value: 'Main Page Content' },
				properties: [{ name: 'level', value: { type: 'integer', value: 1 } }],
				childIds: ['main-text']
			},
			{
				nodeId: 'main-text',
				ignored: false,
				role: { type: 'role', value: 'StaticText' },
				name: { type: 'string', value: 'Main Page Content' }
			}
		];

		const iframeNodes: AXNode[] = [
			{
				nodeId: 'iframe-root',
				ignored: false,
				role: { type: 'role', value: 'RootWebArea' },
				childIds: ['iframe-heading']
			},
			{
				nodeId: 'iframe-heading',
				ignored: false,
				role: { type: 'role', value: 'heading' },
				name: { type: 'string', value: 'Iframe Documentation Content' },
				properties: [{ name: 'level', value: { type: 'integer', value: 2 } }],
				childIds: ['iframe-text']
			},
			{
				nodeId: 'iframe-text',
				ignored: false,
				role: { type: 'role', value: 'StaticText' },
				name: { type: 'string', value: 'Iframe Documentation Content' }
			}
		];

		const nestedIframeNodes: AXNode[] = [
			{
				nodeId: 'nested-root',
				ignored: false,
				role: { type: 'role', value: 'RootWebArea' },
				childIds: ['nested-paragraph']
			},
			{
				nodeId: 'nested-paragraph',
				ignored: false,
				role: { type: 'role', value: 'paragraph' },
				childIds: ['nested-text']
			},
			{
				nodeId: 'nested-text',
				ignored: false,
				role: { type: 'role', value: 'StaticText' },
				name: { type: 'string', value: 'Deeply nested iframe content that should also be extracted' }
			}
		];

		const loader = createWebPageLoader(uri);

		const frameTree = {
			frame: { id: 'main-frame', url: 'https://example.com/page-with-iframes' },
			childFrames: [
				{
					frame: { id: 'iframe-1', url: 'https://example.com/iframe-content' },
					childFrames: [
						{
							frame: { id: 'nested-iframe', url: 'https://example.com/nested-content' },
							childFrames: []
						}
					]
				}
			]
		};

		setupDebuggerMock({
			frameTree,
			axNodes: (frameId: string) => {
				switch (frameId) {
					case 'main-frame':
						return mainFrameNodes;
					case 'iframe-1':
						return iframeNodes;
					case 'nested-iframe':
						return nestedIframeNodes;
					default:
						return [];
				}
			}
		});

		const loadPromise = loader.load();

		window.webContents.emit('did-start-loading');
		window.webContents.emit('did-finish-load');

		const result = await loadPromise;

		assert.strictEqual(result.status, 'ok');
		if (result.status === 'ok') {
			assert.ok(result.result.includes('Main Page Content'), 'Should include main frame content');
			assert.ok(result.result.includes('Iframe Documentation Content'), 'Should include iframe content');
			assert.ok(result.result.includes('Deeply nested iframe content'), 'Should include nested iframe content');
		}

		const getFullAXTreeCalls = window.webContents.debugger.sendCommand.getCalls()
			.filter(call => call.args[0] === 'Accessibility.getFullAXTree');
		assert.strictEqual(getFullAXTreeCalls.length, 3, 'Should call getFullAXTree for all 3 frames');
	}));



	test('onBeforeSendHeaders adds privacy headers for all requests', () => {
		createWebPageLoader(URI.parse('https://example.com/page'));

		assert.ok(window.webContents.session.webRequest.onBeforeSendHeaders.called);
		const callback = window.webContents.session.webRequest.onBeforeSendHeaders.getCall(0).args[0];

		let modifiedHeaders: Record<string, string> | undefined;
		const mockCallback = (details: { requestHeaders: Record<string, string> }) => {
			modifiedHeaders = details.requestHeaders;
		};

		callback(
			{
				url: 'https://example.com/style.css',
				requestHeaders: {
					'TestHeader': 'TestValue'
				}
			},
			mockCallback
		);

		assert.ok(modifiedHeaders);
		assert.strictEqual(modifiedHeaders['DNT'], '1');
		assert.strictEqual(modifiedHeaders['Sec-GPC'], '1');
		assert.strictEqual(modifiedHeaders['TestHeader'], 'TestValue');
		assert.strictEqual(modifiedHeaders['Accept'], undefined);
	});

	test('onBeforeSendHeaders adds Accept header preferring markdown for mainFrame requests', () => {
		createWebPageLoader(URI.parse('https://example.com/page'));

		assert.ok(window.webContents.session.webRequest.onBeforeSendHeaders.called);
		const callback = window.webContents.session.webRequest.onBeforeSendHeaders.getCall(0).args[0];

		let modifiedHeaders: Record<string, string> | undefined;
		const mockCallback = (details: { requestHeaders: Record<string, string> }) => {
			modifiedHeaders = details.requestHeaders;
		};

		callback(
			{
				url: 'https://example.com/page',
				resourceType: 'mainFrame',
				requestHeaders: {}
			},
			mockCallback
		);

		assert.ok(modifiedHeaders);
		assert.ok(modifiedHeaders['Accept']?.includes('text/markdown'));
		assert.ok(modifiedHeaders['Accept']?.includes('text/html'));
	});



	test('onHeadersReceived replaces Content-Disposition attachment with inline for text content', () => {
		createWebPageLoader(URI.parse('https://example.com/page'));

		assert.ok(window.webContents.session.webRequest.onHeadersReceived.called);
		const listener = window.webContents.session.webRequest.onHeadersReceived.getCall(0).args[0];

		for (const contentType of ['application/xml', 'text/html', 'text/plain', 'application/json', 'application/xhtml+xml', 'application/rss+xml', 'application/vnd.custom+json']) {
			let response: { responseHeaders?: Record<string, string[]>; cancel?: boolean } | undefined;
			const mockCallback = (result: { responseHeaders?: Record<string, string[]>; cancel?: boolean }) => {
				response = result;
			};

			listener(
				{
					url: 'https://example.com/file',
					responseHeaders: {
						'Content-Disposition': ['attachment; filename="file.xml"'],
						'Content-Type': [contentType]
					}
				},
				mockCallback
			);

			assert.ok(response, `Expected response for ${contentType}`);
			assert.deepStrictEqual(response!.responseHeaders!['Content-Disposition'], ['inline'], `Expected inline for ${contentType}`);
			assert.strictEqual(response!.cancel, false, `Should not cancel for ${contentType}`);
		}
	});

	test('onHeadersReceived cancels Content-Disposition attachment for binary content', () => {
		createWebPageLoader(URI.parse('https://example.com/page'));

		const listener = window.webContents.session.webRequest.onHeadersReceived.getCall(0).args[0];

		for (const contentType of ['application/octet-stream', 'application/zip', 'application/pdf', 'image/png', 'video/mp4']) {
			let response: { cancel?: boolean } | undefined;
			const mockCallback = (result: { cancel?: boolean }) => {
				response = result;
			};

			listener(
				{
					url: 'https://example.com/file.bin',
					responseHeaders: {
						'Content-Disposition': ['attachment; filename="file.bin"'],
						'Content-Type': [contentType]
					}
				},
				mockCallback
			);

			assert.ok(response, `Expected response for ${contentType}`);
			assert.strictEqual(response!.cancel, true, `Expected cancel for ${contentType}`);
		}
	});

	test('onHeadersReceived cancels Content-Disposition attachment when content type is missing', () => {
		createWebPageLoader(URI.parse('https://example.com/page'));

		const listener = window.webContents.session.webRequest.onHeadersReceived.getCall(0).args[0];

		let response: { cancel?: boolean } | undefined;
		const mockCallback = (result: { cancel?: boolean }) => {
			response = result;
		};

		listener(
			{
				url: 'https://example.com/file',
				responseHeaders: {
					'Content-Disposition': ['attachment; filename="file"']
				}
			},
			mockCallback
		);

		assert.ok(response);
		assert.strictEqual(response!.cancel, true);
	});

	test('onHeadersReceived allows normal responses without Content-Disposition attachment', () => {
		createWebPageLoader(URI.parse('https://example.com/page'));

		const listener = window.webContents.session.webRequest.onHeadersReceived.getCall(0).args[0];

		let response: { responseHeaders?: Record<string, string[]> } | undefined;
		const mockCallback = (result: { responseHeaders?: Record<string, string[]> }) => {
			response = result;
		};

		listener(
			{
				url: 'https://example.com/page',
				responseHeaders: {
					'Content-Type': ['text/html'],
					'Content-Disposition': ['inline']
				}
			},
			mockCallback
		);

		assert.ok(response);
		assert.strictEqual(response!.responseHeaders, undefined);
	});

	test('will-download handler cancels download and returns error', async () => {
		const uri = URI.parse('https://dl.google.com/linux/chrome/rpm/stable/x86_64/repodata/repomd.xml');

		const loader = createWebPageLoader(uri);
		setupDebuggerMock();

		assert.ok(window.webContents.session.on.called);
		const willDownloadCall = window.webContents.session.on.getCalls()
			.find(call => call.args[0] === 'will-download');
		assert.ok(willDownloadCall);
		const willDownloadHandler = willDownloadCall!.args[1];

		const loadPromise = loader.load();

		const mockItem = {
			cancel: sinon.stub(),
			getFilename: sinon.stub().returns('repomd.xml')
		};
		willDownloadHandler({}, mockItem);

		const result = await loadPromise;

		assert.ok(mockItem.cancel.called);

		assert.strictEqual(result.status, 'error');
		if (result.status === 'error') {
			assert.ok(result.error.includes('Download not allowed'));
			assert.ok(result.error.includes('repomd.xml'));
		}
	});



	test('onHeadersReceived detects markdown content-type for mainFrame responses', () => {
		createWebPageLoader(URI.parse('https://example.com/page'));

		const listener = window.webContents.session.webRequest.onHeadersReceived.getCall(0).args[0];

		let response: { cancel?: boolean } | undefined;
		const mockCallback = (result: { cancel?: boolean }) => {
			response = result;
		};

		listener(
			{
				url: 'https://example.com/page',
				resourceType: 'mainFrame',
				responseHeaders: {
					'Content-Type': ['text/markdown; charset=utf-8']
				}
			},
			mockCallback
		);

		assert.ok(response);
		assert.strictEqual(response!.cancel, false);
	});

	test('markdown content-type extraction uses raw body', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://learn.microsoft.com/en-us/docs');

		const loader = createWebPageLoader(uri);
		const longAXNodes: AXNode[] = [
			{
				nodeId: 'node1',
				ignored: false,
				role: { type: 'role', value: 'StaticText' },
				name: { type: 'string', value: 'This is a long accessibility tree content that exceeds the minimum content length requirement of one hundred characters easily.' }
			}
		];
		setupDebuggerMock({ axNodes: longAXNodes });

		const headersListener = window.webContents.session.webRequest.onHeadersReceived.getCall(0).args[0];

		const loadPromise = loader.load();

		headersListener(
			{
				url: uri.toString(),
				resourceType: 'mainFrame',
				responseHeaders: {
					'Content-Type': ['text/markdown; charset=utf-8']
				}
			},
			() => { }
		);

		window.webContents.executeJavaScript.resolves('# Hello World\n\nThis is markdown content.');

		window.webContents.emit('did-start-loading');
		window.webContents.emit('did-finish-load');

		const result = await loadPromise;

		assert.strictEqual(result.status, 'ok');
		assert.ok(result.result.includes('# Hello World'));
		assert.ok(result.result.includes('This is markdown content.'));
	}));



	test('disposes resources after load completes', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const uri = URI.parse('https://example.com/page');

		const loader = createWebPageLoader(uri);
		setupDebuggerMock();

		const loadPromise = loader.load();

		window.webContents.emit('did-start-loading');
		window.webContents.emit('did-finish-load');

		await loadPromise;

		assert.ok(window.destroy.called);
	}));

});

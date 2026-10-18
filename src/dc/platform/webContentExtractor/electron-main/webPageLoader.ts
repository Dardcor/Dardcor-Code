/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { BeforeSendResponse, BrowserWindow, BrowserWindowConstructorOptions, Event, HeadersReceivedResponse, OnBeforeSendHeadersListenerDetails, OnHeadersReceivedListenerDetails } from 'electron';
import { Queue, raceTimeout, TimeoutTimer } from '../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { createSingleCallFunction } from '../../../base/common/functional.js';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { ILogService } from '../../log/common/log.js';
import { IAgentNetworkFilterService } from '../../networkFilter/common/networkFilterService.js';
import { IWebContentExtractorOptions, WebContentExtractResult } from '../common/webContentExtractor.js';
import { AXNode, convertAXTreeToMarkdown } from './cdpAccessibilityDomain.js';

type NetworkRequestEventParams = Readonly<{
	requestId?: string;
	request?: { url?: string };
	response?: { status?: number; statusText?: string };
	type?: string;
}>;

type FrameInfo = Readonly<{
	id: string;
	url?: string;
	name?: string;
}>;

type FrameTreeNode = Readonly<{
	frame: FrameInfo;
	childFrames?: FrameTreeNode[];
}>;

export class WebPageLoader extends Disposable {
	private static readonly TIMEOUT = 30000;
	private static readonly POST_LOAD_TIMEOUT = 5000;
	private static readonly FRAME_TIMEOUT = 500;
	private static readonly EXTRACT_CONTENT_TIMEOUT = 2000;
	private static readonly IDLE_DEBOUNCE_TIME = 500;
	private static readonly MIN_CONTENT_LENGTH = 100;

	private readonly _window: BrowserWindow;
	private readonly _debugger: Electron.Debugger;
	private readonly _requests = new Set<string>();
	private readonly _queue = this._register(new Queue());
	private readonly _timeout = this._register(new TimeoutTimer());
	private readonly _idleDebounceTimer = this._register(new TimeoutTimer());
	private _onResult = (_result: WebContentExtractResult) => { };
	private _didFinishLoad = false;
	private _receivedMarkdown = false;

	constructor(
		browserWindowFactory: (options: BrowserWindowConstructorOptions) => BrowserWindow,
		private readonly _logger: ILogService,
		private readonly _uri: URI,
		private readonly _options: IWebContentExtractorOptions | undefined,
		private readonly _isTrustedDomain: (uri: URI) => boolean,
		private readonly _agentNetworkFilterService: IAgentNetworkFilterService,
	) {
		super();

		this._window = browserWindowFactory({
			width: 800,
			height: 600,
			show: false,
			webPreferences: {
				partition: generateUuid(),
				javascript: true,
				offscreen: true,
				sandbox: true,
				webgl: false,
			}
		});

		this._register(toDisposable(() => this._window.destroy()));

		this._debugger = this._window.webContents.debugger;
		this._debugger.attach('1.1');
		this._debugger.on('message', this.onDebugMessage.bind(this));

		this._window.webContents
			.once('did-start-loading', this.onStartLoading.bind(this))
			.once('did-finish-load', this.onFinishLoad.bind(this))
			.once('did-fail-load', this.onFailLoad.bind(this))
			.on('will-navigate', this.onRedirect.bind(this))
			.on('will-redirect', this.onRedirect.bind(this))
			.on('select-client-certificate', (event) => event.preventDefault());

		this._window.webContents.session.webRequest.onBeforeSendHeaders(
			this.onBeforeSendHeaders.bind(this));

		this._window.webContents.session.webRequest.onHeadersReceived(
			this.onHeadersReceived.bind(this));

		this._window.webContents.session.on('will-download', this.onDownload.bind(this));
	}

	private trace(message: string) {
		this._logger.trace(`[WebPageLoader] [${this._uri}] ${message}`);
	}

	public async load() {
		return await new Promise<WebContentExtractResult>((resolve) => {
			this._onResult = createSingleCallFunction((result) => {
				switch (result.status) {
					case 'ok':
						this.trace(`Loaded web page content, status: ${result.status}, title: '${result.title}', length: ${result.result.length}`);
						break;
					case 'redirect':
						this.trace(`Loaded web page content, status: ${result.status}, toURI: ${result.toURI}`);
						break;
					case 'error':
						this.trace(`Loaded web page content, status: ${result.status}, code: ${result.statusCode}, error: '${result.error}', title: '${result.title}', length: ${result.result?.length ?? 0}`);
						break;
				}

				const content = result.status !== 'redirect' ? result.result : undefined;
				if (content !== undefined) {
					this.trace(content.length < 200 ? `Extracted content: '${content}'` : `Extracted content preview: '${content.substring(0, 200)}...'`);
				}

				resolve(result);
				this.dispose();
			});

			this.trace(`Loading web page content`);
			void this._window.loadURL(this._uri.toString(true));
			this.setTimeout(WebPageLoader.TIMEOUT);
		});
	}

	private setTimeout(time: number) {
		if (this._store.isDisposed) {
			return;
		}

		this.trace(`Setting page load timeout to ${time} ms`);
		this._timeout.cancelAndSet(() => {
			this.trace(`Page load timeout reached`);
			void this._queue.queue(() => this.extractContent());
		}, time);
	}

	private onBeforeSendHeaders(details: OnBeforeSendHeadersListenerDetails, callback: (beforeSendResponse: BeforeSendResponse) => void) {
		const headers = { ...details.requestHeaders };

		headers['DNT'] = '1';
		headers['Sec-GPC'] = '1';

		if (details.resourceType === 'mainFrame') {
			headers['Accept'] = 'text/markdown, text/html;q=0.9, application/xhtml+xml;q=0.9, application/xml;q=0.8, */*;q=0.7';
		}

		callback({ requestHeaders: headers });
	}

	private onHeadersReceived(details: OnHeadersReceivedListenerDetails, callback: (headersReceivedResponse: HeadersReceivedResponse) => void) {
		const headers = details.responseHeaders;
		if (headers) {
			let hasAttachment = false;
			let attachmentHeaderName: string | undefined;
			let contentType: string | undefined;

			for (const name of Object.keys(headers)) {
				const lowerName = name.toLowerCase();
				if (lowerName === 'content-disposition' && headers[name]?.some(v => v.toLowerCase().includes('attachment'))) {
					hasAttachment = true;
					attachmentHeaderName = name;
				}
				if (lowerName === 'content-type') {
					contentType = headers[name]?.[0]?.toLowerCase();
				}
			}

			if (details.resourceType === 'mainFrame') {
				this._receivedMarkdown = contentType?.split(';')[0].trim() === 'text/markdown';
				if (this._receivedMarkdown) {
					this.trace('Received text/markdown response, will extract document text content directly');
				}
			}

			if (hasAttachment && attachmentHeaderName) {
				if (this.isTextMimeType(contentType)) {
					this.trace(`Replacing Content-Disposition: attachment with inline for ${details.url} (content-type: ${contentType})`);
					headers[attachmentHeaderName] = ['inline'];
					callback({ responseHeaders: headers, cancel: false });
				} else {
					this.trace(`Blocked binary download (Content-Disposition: attachment, content-type: ${contentType}) for ${details.url}`);
					callback({ cancel: true });
				}
				return;
			}
		}
		callback({ cancel: false });
	}

	private static readonly TEXT_MIME_TYPE_RE = /^(?:text\/|application\/(?:json|xml|xhtml\+xml|rss\+xml|atom\+xml|svg\+xml|javascript|ecmascript|x-yaml|yaml|toml|.*\+(?:xml|json))$)/;

	private isTextMimeType(contentType: string | undefined): boolean {
		const mimeType = contentType?.split(';')[0].trim();
		return !!mimeType && WebPageLoader.TEXT_MIME_TYPE_RE.test(mimeType);
	}

	private onDownload(_event: Event, item: Electron.DownloadItem) {
		const filename = item.getFilename();
		this.trace(`Blocked download: ${filename}`);
		item.cancel();
		void this._queue.queue(() => this.extractContent({ status: 'error', error: `Download not allowed: ${filename}` }));
	}

	private onStartLoading() {
		if (this._store.isDisposed) {
			return;
		}

		this.trace(`Received 'did-start-loading' event`);
		void this._debugger.sendCommand('Network.enable').catch(() => {
		});
	}

	private onFinishLoad() {
		if (this._store.isDisposed) {
			return;
		}

		this.trace(`Received 'did-finish-load' event`);
		this._didFinishLoad = true;
		this.scheduleIdleCheck();
		this.setTimeout(WebPageLoader.POST_LOAD_TIMEOUT);
	}

	private onFailLoad(_event: Event, statusCode: number, error: string) {
		if (this._store.isDisposed) {
			return;
		}

		this.trace(`Received 'did-fail-load' event, code: ${statusCode}, error: '${error}'`);
		if (statusCode === -3) {
			this.trace(`Ignoring ERR_ABORTED (-3) as it may be caused by CSP or other measures`);
			void this._queue.queue(() => this.extractContent());
		} else if (statusCode === -27) {
			this.trace(`Ignoring ERR_BLOCKED_BY_CLIENT (-27) as it may be caused by ad-blockers or similar extensions`);
			void this._queue.queue(() => this.extractContent());
		} else {
			void this._queue.queue(() => this.extractContent({ status: 'error', statusCode, error }));
		}
	}

	private onRedirect(event: Event, url: string) {
		if (this._store.isDisposed) {
			return;
		}

		this.trace(`Received 'will-navigate' or 'will-redirect' event, url: ${url}`);

		const toURI = URI.parse(url);
		if (!this._agentNetworkFilterService.isUriAllowed(toURI)) {
			this.trace(`Blocking navigation to ${url} (blocked by domain filter policy)`);
			event.preventDefault();
			this._onResult({ status: 'error', error: this._agentNetworkFilterService.formatError(toURI) });
			return;
		}

		if (!this._options?.followRedirects) {
			if (this.normalizeAuthority(toURI.authority) === this.normalizeAuthority(this._uri.authority)) {
				return;
			}

			if (this._isTrustedDomain(toURI)) {
				return;
			}

			if (this._didFinishLoad) {
				this.trace(`Blocking post-load navigation to ${url} (likely ad/tracker script)`);
				event.preventDefault();
				return;
			}

			event.preventDefault();
			this._onResult({ status: 'redirect', toURI });
		}
	}

	private normalizeAuthority(authority: string): string {
		return authority.toLowerCase().replace(/^www\./, '');
	}

	private onDebugMessage(_event: Event, method: string, params: NetworkRequestEventParams) {
		if (this._store.isDisposed) {
			return;
		}

		const { requestId, type, response } = params;
		switch (method) {
			case 'Network.requestWillBeSent':
				if (requestId !== undefined) {
					this._requests.add(requestId);
					this._idleDebounceTimer.cancel();
				}
				break;
			case 'Network.loadingFinished':
			case 'Network.loadingFailed':
				if (requestId !== undefined) {
					this._requests.delete(requestId);
					if (this._requests.size === 0 && this._didFinishLoad) {
						this.scheduleIdleCheck();
					}
				}
				break;
			case 'Network.responseReceived':
				if (type === 'Document') {
					const statusCode = response?.status ?? 0;
					if (statusCode >= 400) {
						const error = response?.statusText || `HTTP error ${statusCode}`;
						void this._queue.queue(() => this.extractContent({ status: 'error', statusCode, error }));
					}
				}
				break;
		}
	}

	private scheduleIdleCheck() {
		if (this._store.isDisposed) {
			return;
		}

		this._idleDebounceTimer.cancelAndSet(async () => {
			if (this._store.isDisposed) {
				return;
			}

			await this.nextFrame();

			if (this._requests.size === 0) {
				this._queue.queue(() => this.extractContent());
			} else {
				this.trace(`New network requests detected, deferring content extraction`);
			}
		}, WebPageLoader.IDLE_DEBOUNCE_TIME);
	}

	private async nextFrame() {
		if (this._store.isDisposed) {
			return;
		}

		await raceTimeout(
			new Promise<void>((resolve) => {
				try {
					this.trace(`Waiting for a frame to be rendered`);
					this._window.webContents.beginFrameSubscription(false, () => {
						try {
							this.trace(`A frame has been rendered`);
							this._window.webContents.endFrameSubscription();
						} catch {
						}
						resolve();
					});
				} catch {
					resolve();
				}
			}),
			WebPageLoader.FRAME_TIMEOUT
		);
	}

	private async extractContent(errorResult?: WebContentExtractResult & { status: 'error' }) {
		if (this._store.isDisposed) {
			return;
		}

		try {
			const title = this._window.webContents.getTitle();

			let result = '';
			const cts = new CancellationTokenSource();
			try {
				await raceTimeout((async () => {
					if (this._receivedMarkdown) {
						this.trace('Extracting markdown text content from document');
						result = await this._window.webContents.executeJavaScript('document.body?.textContent ?? document.documentElement?.textContent ?? ""') ?? '';
						return;
					}

					if (!cts.token.isCancellationRequested) {
						result = await this.extractAccessibilityTreeContent(cts.token) ?? '';
					}

					if (!cts.token.isCancellationRequested && result.length < WebPageLoader.MIN_CONTENT_LENGTH) {
						this.trace(`Accessibility tree extraction yielded insufficient content, trying main DOM element extraction`);
						const domContent = await this.extractMainDomElementContent() ?? '';
						result = domContent.length > result.length ? domContent : result;
					}
				})(), WebPageLoader.EXTRACT_CONTENT_TIMEOUT);
			} finally {
				cts.cancel();
				cts.dispose();
			}

			if (result.length === 0) {
				this._onResult({ status: 'error', error: 'Failed to extract meaningful content from the web page' });
			} else if (errorResult !== undefined) {
				this._onResult({ ...errorResult, result, title });
			} else {
				this._onResult({ status: 'ok', result, title });
			}
		} catch (e) {
			if (errorResult !== undefined) {
				this._onResult(errorResult);
			} else {
				this._onResult({
					status: 'error',
					error: e instanceof Error ? e.message : String(e)
				});
			}
		}
	}

	private async extractAccessibilityTreeContent(token: CancellationToken): Promise<string | undefined> {
		this.trace(`Extracting content using Accessibility domain`);
		try {
			await this._debugger.sendCommand('Page.enable');
			if (token.isCancellationRequested) {
				return undefined;
			}

			const { frameTree } = await this._debugger.sendCommand('Page.getFrameTree') as { frameTree: FrameTreeNode };
			if (token.isCancellationRequested) {
				return undefined;
			}

			const frameNodes = [frameTree];
			for (let i = 0; i < frameNodes.length; i++) {
				frameNodes.push(...frameNodes[i].childFrames ?? []);
			}

			const allNodes: AXNode[] = [];
			for (const { frame } of frameNodes) {
				try {
					const { nodes } = await this._debugger.sendCommand('Accessibility.getFullAXTree', { frameId: frame.id }) as { nodes: AXNode[] };
					allNodes.push(...nodes);
					if (token.isCancellationRequested) {
						return undefined;
					}
				} catch {
				}
			}

			return convertAXTreeToMarkdown(this._uri, allNodes);
		} catch (error) {
			this.trace(`Accessibility tree extraction failed: ${error instanceof Error ? error.message : String(error)}`);
			return undefined;
		}
	}

	private async extractMainDomElementContent(): Promise<string | undefined> {
		try {
			this.trace(`Extracting content from main DOM element`);
			return await this._window.webContents.executeJavaScript(`
				(() => {
					const selectors = ['main','article','[role="main"]','.main-content','#main-content','.article-body','.post-content','.entry-content','.content','body'];
					for (const selector of selectors) {
						const content = document.querySelector(selector)?.textContent?.replace(/[ \\t]+/g, ' ').replace(/\\s{2,}/gm, '\\n').trim();
						if (content && content.length > ${WebPageLoader.MIN_CONTENT_LENGTH}) {
							return content;
						}
					}
					return undefined;
				})();
			`);
		} catch (error) {
			this.trace(`DOM extraction failed: ${error instanceof Error ? error.message : String(error)}`);
			return undefined;
		}
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import type * as playwright from 'playwright-core';
import { Emitter, Event } from '../../../base/common/event.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { createCancelablePromise, raceCancellablePromises, timeout } from '../../../base/common/async.js';
import { URI } from '../../../base/common/uri.js';
import { IAgentNetworkFilterService } from '../../networkFilter/common/networkFilterService.js';
import { IPlaywrightActionScope } from './playwrightService.js';

type IAiAriaSnapshotOptions = NonNullable<Parameters<playwright.Locator['ariaSnapshot']>[0]> & { _track?: string };

declare module 'playwright-core' {
	interface Page {
		ariaSnapshot(options?: IAiAriaSnapshotOptions): Promise<string>;
	}
}

export class DialogInterruptedError extends Error {
	constructor() {
		super('Action was interrupted by a dialog');
		this.name = 'DialogInterruptedError';
	}
}

export class PlaywrightTab {
	private static readonly MAX_DIAGNOSTIC_LOG_ENTRIES = 500;
	private _onDialogStateChanged = new Emitter<void>();

	private _dialog: playwright.Dialog | undefined;
	private _fileChooser: playwright.FileChooser | undefined;
	private _logs: { type: string; time: number; description: string }[] = [];
	private _needsFullSnapshot = false;

	private _initialized: Promise<void>;

	constructor(
		private readonly page: playwright.Page,
		private readonly actionScope: IPlaywrightActionScope,
		private readonly agentNetworkFilterService: IAgentNetworkFilterService,
	) {
		page.on('console', event => this._handleConsoleMessage(event))
			.on('pageerror', error => this._handlePageError(error))
			.on('requestfailed', request => this._handleRequestFailed(request))
			.on('response', response => this._handleResponse(response))
			.on('dialog', dialog => this._handleDialog(dialog))
			.on('download', download => this._handleDownload(download));

		this._initialized = this._initialize();
	}

	private async _initialize() {
		const messages = await this.page.consoleMessages().catch(() => []);
		for (const message of messages) { this._handleConsoleMessage(message); }
		const errors = await this.page.pageErrors().catch(() => []);
		for (const error of errors) { this._handlePageError(error); }
	}

	private _handleDialog(dialog: playwright.Dialog) {
		this._dialog = dialog;
		this.page.waitForFunction(() => true, undefined, { timeout: 0 }).then(() => {
			if (this._dialog === dialog) {
				this._dialog = undefined;
				this._onDialogStateChanged.fire();
			}
		});
		this._onDialogStateChanged.fire();
	}

	async replyToDialog(accept?: boolean, promptText?: string) {
		if (!this._dialog) {
			throw new Error('No active modal dialog to respond to');
		}
		const dialog = this._dialog;
		this._dialog = undefined;
		this._onDialogStateChanged.fire();
		await this.safeRunAgainstPage(async () => {
			if (accept) {
				await dialog.accept(promptText);
			} else {
				await dialog.dismiss();
			}
		});
	}

	private _handleFileChooser(chooser: playwright.FileChooser) {
		this._fileChooser = chooser;
	}

	async replyToFileChooser(files: string[]) {
		if (!this._fileChooser) {
			throw new Error('No active file chooser dialog to respond to');
		}
		const chooser = this._fileChooser;
		this._fileChooser = undefined;
		await this.safeRunAgainstPage(() => chooser.setFiles(files));
	}

	private async _handleDownload(download: playwright.Download) {
		this._recordDiagnostic({ type: 'download', time: Date.now(), description: `${download.suggestedFilename()}` });
	}

	private _handleRequestFailed(request: playwright.Request) {
		const timing = request.timing();
		this._recordDiagnostic({ type: 'requestFailed', time: timing.responseEnd + timing.startTime, description: `${request.method()} request to ${request.url()} failed: "${request.failure()?.errorText}"` });
	}

	private _handleResponse(response: playwright.Response) {
		if (response.status() >= 400) {
			const request = response.request();
			this._recordDiagnostic({ type: 'httpError', time: Date.now(), description: `${request.method()} ${response.status()} ${response.statusText()} at ${response.url()}` });
		}
	}

	private _handleConsoleMessage(message: playwright.ConsoleMessage) {
		if (message.type() === 'error' || message.type() === 'warning') {
			this._recordDiagnostic({ type: 'console', time: message.timestamp(), description: `[${message.type()}] ${message.text()}` });
		}
	}

	private _handlePageError(error: Error) {
		this._recordDiagnostic({ type: 'pageError', time: Date.now(), description: error.stack ?? error.message });
	}

	private _recordDiagnostic(entry: { type: string; time: number; description: string }): void {
		this._logs.push(entry);
		if (this._logs.length > PlaywrightTab.MAX_DIAGNOSTIC_LOG_ENTRIES) {
			this._logs.splice(0, this._logs.length - PlaywrightTab.MAX_DIAGNOSTIC_LOG_ENTRIES);
		}
	}

	private _getBlockedURLErrorMessage(): string | undefined {
		const url = this.page.url();
		if (!url || url === 'about:blank') {
			return undefined;
		}
		let uri: URI | undefined;
		try { uri = URI.parse(url); } catch { }
		if (uri && !this.agentNetworkFilterService.isUriAllowed(uri)) {
			return this.agentNetworkFilterService.formatError(uri);
		}
		return undefined;
	}

	async safeRunAgainstPage<T>(action: (page: playwright.Page, token: CancellationToken) => Promise<T>): Promise<T> {
		if (this._dialog) {
			throw new Error(`Cannot perform action while a dialog is open`);
		}

		const blockedError = this._getBlockedURLErrorMessage();
		if (blockedError) {
			throw new Error(blockedError);
		}

		let actionDidComplete = false;
		let result: T | void;
		const dialogOpened = Event.toPromise(this._onDialogStateChanged.event);
		const actionCompleted = createCancelablePromise(async (token) => {

			const handleFileChooser = (chooser: playwright.FileChooser) => this._handleFileChooser(chooser);
			this.page.on('filechooser', handleFileChooser);

			try {
				this.actionScope.activeCalls++;
				result = await this.runAndWaitForCompletion((token) => action(this.page, token), token);
				actionDidComplete = true;
			} finally {
				this.page.off('filechooser', handleFileChooser);
				this.actionScope.activeCalls--;
			}
		});

		return raceCancellablePromises([dialogOpened, actionCompleted]).then(() => {
			if (!actionDidComplete) {
				throw new DialogInterruptedError();
			}
			return result!;
		});
	}

	async getSummary(full = this._needsFullSnapshot): Promise<string> {
		await this._initialized;

		const blockedError = this._getBlockedURLErrorMessage();
		if (blockedError) {
			return blockedError;
		}

		if (full && this._needsFullSnapshot) {
			this._needsFullSnapshot = false;
		}

		const snapshotFromPage = await this.safeRunAgainstPage((page) => this.getAiSnapshot(page, full)).catch(() => {
			this._needsFullSnapshot = true;
			return undefined;
		});
		const title = await this.safeRunAgainstPage((page) => page.title()).catch(() => '');

		const logs = this._logs;
		this._logs = [];

		const snapshot = snapshotFromPage?.trim() ?? '';

		return [
			...(title ? [`Page Title: ${title}`] : []),
			`URL: ${this.page.url()}`,
			...(this._dialog ? [`Active ${this._dialog.type()} dialog: "${this._dialog.message()}"`] : []),
			...(this._fileChooser ? [`Active file chooser dialog`] : []),
			...(logs.length > 0 ? [
				`Recent events:`,
				...logs.map(log => `- [${new Date(log.time).toISOString()}] (${log.type}) ${log.description}`)
			] : []),
			`Snapshot: ${snapshotFromPage !== undefined ? snapshot ? `\n${snapshot}` : '<unchanged>' : '<unavailable>'}`,
		].join('\n');
	}

	getAndClearDiagnostics(): readonly string[] {
		const logs = this._logs;
		this._logs = [];
		return logs.map(log => `[${log.type}] ${log.description}`);
	}

	private getAiSnapshot(page: playwright.Page, full: boolean): Promise<string> {
		const options: IAiAriaSnapshotOptions = { mode: 'ai' };
		if (!full) {
			options._track = 'response';
		}
		return page.ariaSnapshot(options);
	}

	private async runAndWaitForCompletion<T>(callback: (token: CancellationToken) => Promise<T>, token = CancellationToken.None): Promise<T> {
		const requests: playwright.Request[] = [];

		const requestListener = (request: playwright.Request) => requests.push(request);
		const disposeListeners = () => {
			this.page.off('request', requestListener);
		};
		this.page.on('request', requestListener);

		let result: T;
		try {
			result = await callback(token);
		} finally {
			disposeListeners();
		}

		const requestedNavigation = requests.some(request => request.isNavigationRequest());
		if (requestedNavigation) {
			await this.page.mainFrame().waitForLoadState('load', { timeout: 10000 }).catch(() => { });
			return result;
		}

		const promises: Promise<unknown>[] = [];
		for (const request of requests) {
			if (['document', 'stylesheet', 'script', 'xhr', 'fetch'].includes(request.resourceType())) { promises.push(request.response().then(r => r?.finished()).catch(() => { })); }
			else { promises.push(request.response().catch(() => { })); }
		}
		await raceCancellablePromises<unknown>([
			Promise.all(promises),
			timeout(5000)
		]);

		return result;
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as playwright from '@playwright/test';
import type { Protocol } from 'playwright-core/types/protocol';
import { dirname, join } from 'path';
import { promises, readFileSync } from 'fs';
import { IWindowDriver } from './driver';
import { measureAndLog } from './logger';
import { LaunchOptions } from './code';
import { teardown } from './processes';
import { ChildProcess } from 'child_process';
import type { AxeResults, RunOptions } from 'axe-core';

let axeSource = '';
try {
	const axePath = require.resolve('axe-core/axe.min.js');
	axeSource = readFileSync(axePath, 'utf-8');
} catch {
	axeSource = '';
}

type PageFunction<Arg, T> = (arg: Arg) => T | Promise<T>;

export interface AccessibilityScanOptions {
	selector?: string;
	tags?: string[];
	disableRules?: string[];
	excludeRules?: { [ruleId: string]: string[] };
}

export class PlaywrightDriver {

	private static traceCounter = 1;
	private static screenShotCounter = 1;

	private static readonly vscodeToPlaywrightKey: { [key: string]: string } = {
		cmd: 'Meta',
		ctrl: 'Control',
		shift: 'Shift',
		enter: 'Enter',
		escape: 'Escape',
		right: 'ArrowRight',
		up: 'ArrowUp',
		down: 'ArrowDown',
		left: 'ArrowLeft',
		home: 'Home',
		esc: 'Escape'
	};

	constructor(
		private readonly application: playwright.Browser | playwright.ElectronApplication,
		private readonly context: playwright.BrowserContext,
		private _currentPage: playwright.Page,
		private readonly serverProcess: ChildProcess | undefined,
		private readonly whenLoaded: Promise<unknown>,
		private readonly options: LaunchOptions
	) {
	}

	get browserContext(): playwright.BrowserContext {
		return this.context;
	}

	private get page(): playwright.Page {
		return this._currentPage;
	}

	get currentPage(): playwright.Page {
		return this._currentPage;
	}

	getAllWindows(): playwright.Page[] {
		if ('windows' in this.application) {
			return (this.application as playwright.ElectronApplication).windows();
		}
		return this.context.pages();
	}

	switchToWindow(indexOrUrl: number | string): playwright.Page | undefined {
		const windows = this.getAllWindows();
		if (typeof indexOrUrl === 'number') {
			if (indexOrUrl >= 0 && indexOrUrl < windows.length) {
				this._currentPage = windows[indexOrUrl];
				this._cdpSession = undefined;
				return this._currentPage;
			}
		} else {
			let found = windows.find(w => w.url() === indexOrUrl);
			if (!found) {
				found = windows.find(w => w.url().includes(indexOrUrl));
			}
			if (found) {
				this._currentPage = found;
				this._cdpSession = undefined;
				return this._currentPage;
			}
		}
		return undefined;
	}

	getWindowsInfo(): { index: number; url: string; isCurrent: boolean }[] {
		const windows = this.getAllWindows();
		return windows.map((p, index) => ({
			index,
			url: p.url(),
			isCurrent: p === this._currentPage
		}));
	}

	async screenshotBuffer(fullPage: boolean = false): Promise<Buffer> {
		return await this.page.screenshot({
			type: 'png',
			fullPage
		});
	}

	async getAccessibilitySnapshot(): Promise<string> {
		return await this.page.ariaSnapshot({ mode: 'ai' });
	}

	async clickSelector(selector: string, options?: { button?: 'left' | 'right' | 'middle'; clickCount?: number }): Promise<void> {
		await this.page.click(selector, {
			button: options?.button ?? 'left',
			clickCount: options?.clickCount ?? 1
		});
	}

	async typeText(selector: string, text: string, slowly: boolean = false): Promise<void> {
		if (slowly) {
			await this.page.type(selector, text, { delay: 50 });
		} else {
			await this.page.fill(selector, text);
		}
	}

	async evaluateExpression<T = unknown>(expression: string): Promise<T> {
		return await this.page.evaluate(expression) as T;
	}

	async getLocatorInfo(selector: string, action?: 'count' | 'textContent' | 'innerHTML' | 'boundingBox' | 'isVisible'): Promise<
		number | string[] | { x: number; y: number; width: number; height: number } | null | boolean | { count: number; firstVisible: boolean }
	> {
		const locator = this.page.locator(selector);

		switch (action) {
			case 'count':
				return await locator.count();
			case 'textContent':
				return await locator.allTextContents();
			case 'innerHTML':
				return await locator.allInnerTexts();
			case 'boundingBox':
				return await locator.first().boundingBox();
			case 'isVisible':
				return await locator.first().isVisible();
			default:
				return {
					count: await locator.count(),
					firstVisible: await locator.first().isVisible().catch(() => false)
				};
		}
	}

	async waitForElement(selector: string, options?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }): Promise<void> {
		await this.page.waitForSelector(selector, {
			state: options?.state ?? 'visible',
			timeout: options?.timeout ?? 30000
		});
	}

	async hoverSelector(selector: string): Promise<void> {
		await this.page.hover(selector);
	}

	async dragSelector(sourceSelector: string, targetSelector: string): Promise<void> {
		await this.page.dragAndDrop(sourceSelector, targetSelector);
	}

	async pressKey(key: string): Promise<void> {
		await this.page.keyboard.press(key);
	}

	async mouseMove(x: number, y: number): Promise<void> {
		await this.page.mouse.move(x, y);
	}

	async mouseClick(x: number, y: number, options?: { button?: 'left' | 'right' | 'middle'; clickCount?: number }): Promise<void> {
		await this.page.mouse.click(x, y, {
			button: options?.button ?? 'left',
			clickCount: options?.clickCount ?? 1
		});
	}

	async mouseDrag(startX: number, startY: number, endX: number, endY: number): Promise<void> {
		await this.page.mouse.move(startX, startY);
		await this.page.mouse.down();
		await this.page.mouse.move(endX, endY);
		await this.page.mouse.up();
	}

	async selectOption(selector: string, value: string | string[]): Promise<string[]> {
		return await this.page.selectOption(selector, value);
	}

	async fillForm(fields: { selector: string; value: string }[]): Promise<void> {
		for (const field of fields) {
			await this.page.fill(field.selector, field.value);
		}
	}

	async getConsoleMessages(): Promise<{ type: string; text: string }[]> {
		const messages = await this.page.consoleMessages();
		return messages.map(m => ({
			type: m.type(),
			text: m.text()
		}));
	}

	async waitForText(options: { text?: string; textGone?: string; timeout?: number }): Promise<void> {
		const { text, textGone, timeout = 30000 } = options;

		if (text) {
			await this.page.getByText(text).first().waitFor({ state: 'visible', timeout });
		}
		if (textGone) {
			await this.page.getByText(textGone).first().waitFor({ state: 'hidden', timeout });
		}
	}

	async waitForTime(ms: number): Promise<void> {
		await new Promise(resolve => setTimeout(resolve, ms));
	}

	async verifyElementVisible(selector: string): Promise<boolean> {
		try {
			await this.page.locator(selector).first().waitFor({ state: 'visible', timeout: 5000 });
			return true;
		} catch {
			return false;
		}
	}

	async verifyTextVisible(text: string): Promise<boolean> {
		try {
			await this.page.getByText(text).first().waitFor({ state: 'visible', timeout: 5000 });
			return true;
		} catch {
			return false;
		}
	}

	async getInputValue(selector: string): Promise<string> {
		return await this.page.inputValue(selector);
	}

	async startTracing(name?: string): Promise<void> {
		if (!this.options.tracing) {
			return;
		}

		try {
			await measureAndLog(() => this.context.tracing.startChunk({ title: name }), `startTracing${name ? ` for ${name}` : ''}`, this.options.logger);
		} catch (error) {
		}
	}

	async stopTracing(name?: string, persist: boolean = false): Promise<void> {
		if (!this.options.tracing) {
			return;
		}

		try {
			let persistPath: string | undefined = undefined;
			if (persist) {
				const nameSuffix = name ? `-${name.replace(/\s+/g, '-')}` : '';
				persistPath = join(this.options.logsPath, `playwright-trace-${PlaywrightDriver.traceCounter++}${nameSuffix}.zip`);
			}

			await measureAndLog(() => this.context.tracing.stopChunk({ path: persistPath }), `stopTracing${name ? ` for ${name}` : ''}`, this.options.logger);

			if (persist) {
				await this.takeScreenshot(name);
			}
		} catch (error) {
		}
	}

	async didFinishLoad(): Promise<void> {
		await this.whenLoaded;
	}

	private _cdpSession: playwright.CDPSession | undefined;

	async startCDP() {
		if (this._cdpSession) {
			return;
		}

		this._cdpSession = await this.page.context().newCDPSession(this.page);
	}

	async collectGarbage() {
		if (!this._cdpSession) {
			throw new Error('CDP not started');
		}

		await this._cdpSession.send('HeapProfiler.collectGarbage');
	}

	async evaluate(options: Protocol.Runtime.evaluateParameters): Promise<Protocol.Runtime.evaluateReturnValue> {
		if (!this._cdpSession) {
			throw new Error('CDP not started');
		}

		return await this._cdpSession.send('Runtime.evaluate', options);
	}

	async releaseObjectGroup(parameters: Protocol.Runtime.releaseObjectGroupParameters): Promise<void> {
		if (!this._cdpSession) {
			throw new Error('CDP not started');
		}

		await this._cdpSession.send('Runtime.releaseObjectGroup', parameters);
	}

	async queryObjects(parameters: Protocol.Runtime.queryObjectsParameters): Promise<Protocol.Runtime.queryObjectsReturnValue> {
		if (!this._cdpSession) {
			throw new Error('CDP not started');
		}

		return await this._cdpSession.send('Runtime.queryObjects', parameters);
	}

	async callFunctionOn(parameters: Protocol.Runtime.callFunctionOnParameters): Promise<Protocol.Runtime.callFunctionOnReturnValue> {
		if (!this._cdpSession) {
			throw new Error('CDP not started');
		}

		return await this._cdpSession.send('Runtime.callFunctionOn', parameters);
	}

	async takeHeapSnapshot(): Promise<string> {
		if (!this._cdpSession) {
			throw new Error('CDP not started');
		}

		let snapshot = '';
		const listener = (c: { chunk: string }) => {
			snapshot += c.chunk;
		};

		this._cdpSession.addListener('HeapProfiler.addHeapSnapshotChunk', listener);

		await this._cdpSession.send('HeapProfiler.takeHeapSnapshot');

		this._cdpSession.removeListener('HeapProfiler.addHeapSnapshotChunk', listener);
		return snapshot;
	}

	async getProperties(parameters: Protocol.Runtime.getPropertiesParameters): Promise<Protocol.Runtime.getPropertiesReturnValue> {
		if (!this._cdpSession) {
			throw new Error('CDP not started');
		}

		return await this._cdpSession.send('Runtime.getProperties', parameters);
	}

	private async takeScreenshot(name?: string): Promise<void> {
		try {
			const nameSuffix = name ? `-${name.replace(/\s+/g, '-')}` : '';
			const persistPath = join(this.options.logsPath, `playwright-screenshot-${PlaywrightDriver.screenShotCounter++}${nameSuffix}.png`);

			await measureAndLog(() => this.page.screenshot({ path: persistPath, type: 'png' }), 'takeScreenshot', this.options.logger);
		} catch (error) {
		}
	}

	async reload() {
		await this.page.reload();
	}

	async close() {

		try {
			if (this.options.tracing) {
				await measureAndLog(() => this.context.tracing.stop(), 'stop tracing', this.options.logger);
			}
		} catch (error) {
		}

		if (this.options.web) {
			try {
				await measureAndLog(() => this.saveWebClientLogs(), 'saveWebClientLogs()', this.options.logger);
			} catch (error) {
				this.options.logger.log(`Error saving web client logs (${error})`);
			}
		}

		try {
			await measureAndLog(() => this.application.close(), 'playwright.close()', this.options.logger);
		} catch (error) {
			this.options.logger.log(`Error closing application (${error})`);
		}

		if (this.serverProcess) {
			await measureAndLog(() => teardown(this.serverProcess!, this.options.logger), 'teardown server process', this.options.logger);
		}
	}

	private async saveWebClientLogs(): Promise<void> {
		const logs = await this.getLogs();

		for (const log of logs) {
			const absoluteLogsPath = join(this.options.logsPath, log.relativePath);

			await promises.mkdir(dirname(absoluteLogsPath), { recursive: true });
			await promises.writeFile(absoluteLogsPath, log.contents);
		}
	}

	async sendKeybinding(keybinding: string, accept?: () => Promise<void> | void) {
		const chords = keybinding.split(' ');
		for (let i = 0; i < chords.length; i++) {
			const chord = chords[i];
			if (i > 0) {
				await this.wait(100);
			}

			if (keybinding.startsWith('Alt') || keybinding.startsWith('Control') || keybinding.startsWith('Backspace')) {
				await this.page.keyboard.press(keybinding);
				return;
			}

			const keys = chord.split('+');
			const keysDown: string[] = [];
			for (let i = 0; i < keys.length; i++) {
				if (keys[i] in PlaywrightDriver.vscodeToPlaywrightKey) {
					keys[i] = PlaywrightDriver.vscodeToPlaywrightKey[keys[i]];
				}
				await this.page.keyboard.down(keys[i]);
				keysDown.push(keys[i]);
			}
			while (keysDown.length > 0) {
				await this.page.keyboard.up(keysDown.pop()!);
			}
		}

		await accept?.();
	}

	async click(selector: string, xoffset?: number | undefined, yoffset?: number | undefined) {
		const { x, y } = await this.getElementXY(selector, xoffset, yoffset);
		if (xoffset !== undefined && yoffset !== undefined) {
			await this.page.mouse.click(x, y);
		} else {
			await this.page.mouse.click(x + (xoffset ?? 0), y + (yoffset ?? 0));
		}
	}

	async robustClick(selector: string, timeoutMs: number = 2000): Promise<void> {
		try {
			await this.page.click(selector, { timeout: timeoutMs });
			return;
		} catch (err) {
			if (!this.isPointerInterceptedError(err)) {
				throw err;
			}
			try {
				await this.clickAtStablePosition(selector);
			} catch (fallbackErr) {
				const orig = err instanceof Error ? err.message : String(err);
				const fb = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
				throw new Error(`robustClick fallback failed for '${selector}'. Original page.click error: ${orig}. Fallback error: ${fb}`);
			}
		}
	}

	private isPointerInterceptedError(err: unknown): boolean {
		const message = err instanceof Error ? err.message : String(err);
		return message.includes('intercepts pointer events');
	}

	private async clickAtStablePosition(selector: string, intervalMs: number = 100, timeoutMs: number = 5000): Promise<void> {
		let last: { x: number; y: number } | undefined;
		const start = Date.now();
		while (true) {
			const current = await this.getElementXY(selector);
			if (last && last.x === current.x && last.y === current.y) {
				await this.page.mouse.click(current.x, current.y);
				return;
			}
			last = current;
			if (Date.now() - start > timeoutMs) {
				throw new Error(`Element position never stabilized for '${selector}' within ${timeoutMs}ms`);
			}
			await wait(intervalMs);
		}
	}

	async setValue(selector: string, text: string) {
		return this.page.evaluate(([driver, selector, text]) => driver.setValue(selector, text), [await this.getDriverHandle(), selector, text] as const);
	}

	async getTitle() {
		return this.page.title();
	}

	async isActiveElement(selector: string) {
		return this.page.evaluate(([driver, selector]) => driver.isActiveElement(selector), [await this.getDriverHandle(), selector] as const);
	}

	async getElements(selector: string, recursive: boolean = false) {
		return this.page.evaluate(([driver, selector, recursive]) => driver.getElements(selector, recursive), [await this.getDriverHandle(), selector, recursive] as const);
	}

	async getElementXY(selector: string, xoffset?: number, yoffset?: number) {
		return this.page.evaluate(([driver, selector, xoffset, yoffset]) => driver.getElementXY(selector, xoffset, yoffset), [await this.getDriverHandle(), selector, xoffset, yoffset] as const);
	}

	async typeInEditor(selector: string, text: string) {
		return this.page.evaluate(([driver, selector, text]) => driver.typeInEditor(selector, text), [await this.getDriverHandle(), selector, text] as const);
	}

	async getEditorSelection(selector: string) {
		return this.page.evaluate(([driver, selector]) => driver.getEditorSelection(selector), [await this.getDriverHandle(), selector] as const);
	}

	async getTerminalBuffer(selector: string) {
		return this.page.evaluate(([driver, selector]) => driver.getTerminalBuffer(selector), [await this.getDriverHandle(), selector] as const);
	}

	async writeInTerminal(selector: string, text: string) {
		return this.page.evaluate(([driver, selector, text]) => driver.writeInTerminal(selector, text), [await this.getDriverHandle(), selector, text] as const);
	}

	async getLocaleInfo() {
		return this.evaluateWithDriver(([driver]) => driver.getLocaleInfo());
	}

	async getLocalizedStrings() {
		return this.evaluateWithDriver(([driver]) => driver.getLocalizedStrings());
	}

	async getLogs() {
		return this.page.evaluate(([driver]) => driver.getLogs(), [await this.getDriverHandle()] as const);
	}

	private async evaluateWithDriver<T>(pageFunction: PageFunction<IWindowDriver[], T>) {
		return this.page.evaluate(pageFunction, [await this.getDriverHandle()]);
	}

	wait(ms: number): Promise<void> {
		return wait(ms);
	}

	whenWorkbenchRestored(): Promise<void> {
		return this.evaluateWithDriver(([driver]) => driver.whenWorkbenchRestored());
	}

	private async getDriverHandle(): Promise<playwright.JSHandle<IWindowDriver>> {
		return this.page.evaluateHandle('window.driver');
	}

	async isAlive(): Promise<boolean> {
		try {
			await this.getDriverHandle();
			return true;
		} catch (error) {
			return false;
		}
	}

	async runAccessibilityScan(options?: AccessibilityScanOptions): Promise<AxeResults> {
		await this.page.evaluate(axeSource);

		const runOptions: RunOptions = {
			runOnly: {
				type: 'tag',
				values: options?.tags ?? ['wcag2a', 'wcag2aa', 'wcag21aa']
			}
		};

		if (options?.disableRules && options.disableRules.length > 0) {
			runOptions.rules = {};
			for (const ruleId of options.disableRules) {
				runOptions.rules[ruleId] = { enabled: false };
			}
		}

		const context: { include?: string[]; exclude?: string[][] } = {};

		if (options?.selector) {
			context.include = [options.selector];
		}

		context.exclude = [
			['.monaco-editor .view-lines'],
			['.xterm-screen canvas']
		];

		const results = await measureAndLog(
			() => this.page.evaluate(
				([ctx, opts]) => {
					// @ts-expect-error axe is injected globally
					return window.axe.run(ctx, opts);
				},
				[context, runOptions] as const
			),
			'runAccessibilityScan',
			this.options.logger
		);

		return results as AxeResults;
	}

	async assertNoAccessibilityViolations(options?: AccessibilityScanOptions): Promise<void> {
		const results = await this.runAccessibilityScan(options);

		let filteredViolations = results.violations;
		if (options?.excludeRules) {
			filteredViolations = results.violations.map((violation: AxeResults['violations'][number]) => {
				const excludePatterns = options.excludeRules![violation.id];
				if (!excludePatterns) {
					return violation;
				}
				const filteredNodes = violation.nodes.filter((node: AxeResults['violations'][number]['nodes'][number]) => {
					const target = node.target.join(' ');
					const html = node.html || '';
					return !excludePatterns.some(pattern => target.includes(pattern) || html.includes(pattern));
				});
				return { ...violation, nodes: filteredNodes };
			}).filter((violation: AxeResults['violations'][number]) => violation.nodes.length > 0);
		}

		if (filteredViolations.length > 0) {
			const violationMessages = filteredViolations.map((violation: AxeResults['violations'][number]) => {
				const nodes = violation.nodes.map((node: AxeResults['violations'][number]['nodes'][number]) => {
					const target = node.target.join(' > ');
					const html = node.html || 'N/A';
					const classMatch = html.match(/class="([^"]+)"/);
					const className = classMatch ? classMatch[1] : 'no class';
					return [
						`  Element: ${target}`,
						`    Class: ${className}`,
						`    HTML: ${html}`,
						`    Issue: ${node.failureSummary}`
					].join('\n');
				}).join('\n\n');
				return [
					`[${violation.id}] ${violation.help} (${violation.impact})`,
					`  Help URL: ${violation.helpUrl}`,
					nodes
				].join('\n');
			}).join('\n\n---\n\n');

			throw new Error(
				`Accessibility violations found:\n\n${violationMessages}\n\n` +
				`Total: ${filteredViolations.length} violation(s) affecting ${filteredViolations.reduce((sum: number, v: AxeResults['violations'][number]) => sum + v.nodes.length, 0)} element(s)`
			);
		}
	}
}

export function wait(ms: number): Promise<void> {
	return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export type { AxeResults };

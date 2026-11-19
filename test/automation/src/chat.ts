/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from './code';

const CHAT_VIEW = 'div[id="workbench.panel.chat"]';
const CHAT_EDITOR = '.editor-instance .interactive-session';
const CHAT_INPUT_EDITOR = `${CHAT_VIEW} .interactive-input-part .monaco-editor[role="code"]`;
const CHAT_INPUT_EDITOR_FOCUSED = `${CHAT_VIEW} .interactive-input-part .monaco-editor.focused[role="code"]`;
const CHAT_SEND_BUTTON_ENABLED = `${CHAT_VIEW} .chat-input-toolbars > .chat-execute-toolbar .monaco-action-bar .action-item:not(.disabled) > .action-label.codicon-arrow-up-compact`;
const CHAT_RESPONSE = `${CHAT_VIEW} .interactive-item-container.interactive-response`;
const CHAT_RESPONSE_COMPLETE = `${CHAT_RESPONSE}:not(.chat-response-loading)`;
const CHAT_RESPONSE_RENDERED = `${CHAT_RESPONSE} .rendered-markdown`;
const CHAT_FOOTER_DETAILS = `${CHAT_VIEW} .chat-footer-details`;
const CHAT_MODEL_PICKER_NAME = `${CHAT_VIEW} .interactive-input-part .model-picker-name`;
const CHAT_MODEL_PICKER_CONFIG = `${CHAT_VIEW} .interactive-input-part .model-picker-config`;
const AUXILIARYBAR_PART = '.part.auxiliarybar';
const ACTION_WIDGET = '.action-widget';
const ACTION_WIDGET_ROW = '.action-widget .monaco-list-row.action';
const CHAT_CONTEXT_USAGE_WIDGET = `${CHAT_VIEW} .chat-context-usage-widget`;
const CONTEXT_USAGE_DETAILS = '.chat-context-usage-details';
const CONTEXT_USAGE_TOKEN_LABEL = `${CONTEXT_USAGE_DETAILS} .quota-label span:not(.quota-value)`;
const CHAT_EDITOR_INPUT_EDITOR = `${CHAT_EDITOR} .interactive-input-part .monaco-editor[role="code"]`;
const CHAT_EDITOR_INPUT_EDITOR_FOCUSED = `${CHAT_EDITOR} .interactive-input-part .monaco-editor.focused[role="code"]`;
const CHAT_EDITOR_SEND_BUTTON_ENABLED = `${CHAT_EDITOR} .chat-input-toolbars > .chat-execute-toolbar .monaco-action-bar .action-item:not(.disabled) > .action-label.codicon-arrow-up-compact`;
const CHAT_EDITOR_RESPONSE = `${CHAT_EDITOR} .interactive-item-container.interactive-response`;
const CHAT_EDITOR_RESPONSE_COMPLETE = `${CHAT_EDITOR_RESPONSE}:not(.chat-response-loading)`;
const CHAT_EDITOR_RESPONSE_RENDERED = `${CHAT_EDITOR_RESPONSE} .rendered-markdown`;

export class Chat {

	constructor(private code: Code) { }

	private get chatInputSelector(): string {
		return `${CHAT_INPUT_EDITOR} ${!this.code.editContextEnabled ? 'textarea' : '.native-edit-context'}`;
	}

	private get chatEditorInputSelector(): string {
		return `${CHAT_EDITOR_INPUT_EDITOR} ${!this.code.editContextEnabled ? 'textarea' : '.native-edit-context'}`;
	}

	async waitForChatView(): Promise<void> {
		await this.code.waitForElement(CHAT_VIEW);
	}

	async waitForChatEditor(retryCount?: number): Promise<void> {
		await this.code.waitForElement(CHAT_EDITOR, undefined, retryCount);
	}

	async waitForInputFocus(): Promise<void> {
		await this.code.waitForElement(CHAT_INPUT_EDITOR_FOCUSED);
	}

	async sendMessage(message: string): Promise<void> {
		await this.code.waitAndClick(CHAT_INPUT_EDITOR);

		await this.waitForInputFocus();

		const sanitizedMessage = message.replace(/\n/g, ' ');
		await this.code.waitForTypeInEditor(this.chatInputSelector, sanitizedMessage);

		await this.code.waitForElement(CHAT_SEND_BUTTON_ENABLED, undefined, 600);
		await this.code.waitAndClick(CHAT_SEND_BUTTON_ENABLED);
	}

	async sendEditorMessage(message: string): Promise<void> {
		await this.code.waitAndClick(CHAT_EDITOR_INPUT_EDITOR);
		await this.code.waitForElement(CHAT_EDITOR_INPUT_EDITOR_FOCUSED);

		const sanitizedMessage = message.replace(/\n/g, ' ');
		await this.code.waitForTypeInEditor(this.chatEditorInputSelector, sanitizedMessage);

		await this.code.waitForElement(CHAT_EDITOR_SEND_BUTTON_ENABLED, undefined, 600);
		await this.code.waitAndClick(CHAT_EDITOR_SEND_BUTTON_ENABLED);
	}

	async waitForResponse(retryCount?: number, expectedCount: number = 1): Promise<void> {

		await this.code.waitForElements(CHAT_RESPONSE_COMPLETE, false, els => els.length >= expectedCount, retryCount);
	}

	async waitForEditorResponse(retryCount?: number, expectedCount: number = 1): Promise<void> {
		await this.code.waitForElements(CHAT_EDITOR_RESPONSE_COMPLETE, false, els => els.length >= expectedCount, retryCount);
	}

	async waitForResponseText(predicate: string | RegExp, timeoutMs: number = 60_000, options?: { acceptToolConfirmations?: boolean }): Promise<string> {
		return await this.pollForResponseText(CHAT_RESPONSE, CHAT_RESPONSE_RENDERED, predicate, timeoutMs, options?.acceptToolConfirmations);
	}

	async waitForEditorResponseText(predicate: string | RegExp, timeoutMs: number = 60_000, options?: { acceptToolConfirmations?: boolean }): Promise<string> {
		const matched = await this.pollForResponseText(CHAT_EDITOR_RESPONSE, CHAT_EDITOR_RESPONSE_RENDERED, predicate, timeoutMs, options?.acceptToolConfirmations);
		await this.waitForEditorChatBoundToCommittedResource();
		return matched;
	}

	private async waitForEditorChatBoundToCommittedResource(timeoutMs: number = 15_000): Promise<void> {
		const selector = `.editor-instance .chat-editor-relative[data-bound-chat-resource]:not([data-bound-chat-resource*="/untitled-"])`;
		try {
			await this.code.driver.waitForElement(selector, { state: 'attached', timeout: timeoutMs });
		} catch {
		}
	}

	private async pollForResponseText(bubbleSelector: string, renderedSelector: string, predicate: string | RegExp, timeoutMs: number, acceptToolConfirmations?: boolean): Promise<string> {
		const deadline = Date.now() + timeoutMs;
		const matches = (text: string) => typeof predicate === 'string' ? text.includes(predicate) : predicate.test(text);
		while (Date.now() < deadline) {
			if (acceptToolConfirmations) {
				await acceptToolConfirmationIfPresent(this.code);
			}
			const elements = await this.code.driver.getElements(renderedSelector, true);
			const matched = elements.map(el => el.textContent ?? '').filter(matches);
			if (matched.length > 0) {
				await this.waitForResponseSettled(bubbleSelector, 15_000, 4_000);
				return matched[matched.length - 1];
			}
			await new Promise(r => setTimeout(r, 250));
		}
		throw new Error(`Timed out waiting for response matching ${predicate} in '${renderedSelector}'`);
	}

	private async waitForResponseSettled(bubbleSelector: string, timeoutMs: number, fallbackQuietMs: number): Promise<void> {
		const settledSelector = `${bubbleSelector}:not(.chat-response-loading)`;
		const start = Date.now();
		const deadline = start + timeoutMs;
		while (Date.now() < deadline) {
			const settled = await this.code.driver.getElements(settledSelector, true);
			if (settled.length > 0) {
				return;
			}
			await new Promise(r => setTimeout(r, 200));
		}
		const elapsed = Date.now() - start;
		if (elapsed < fallbackQuietMs) {
			await new Promise(r => setTimeout(r, fallbackQuietMs - elapsed));
		}
	}

	async getLatestEditorResponseText(): Promise<string> {
		const response = this.code.driver.currentPage.locator(CHAT_EDITOR_RESPONSE).last();
		return (await response.textContent()) ?? '';
	}

	async getLatestResponseText(): Promise<string> {
		const response = this.code.driver.currentPage.locator(CHAT_RESPONSE).last();
		return (await response.textContent()) ?? '';
	}

	async waitForModelInFooter(): Promise<void> {
		await this.code.waitForElements(CHAT_FOOTER_DETAILS, false, el => {
			return el.some(el => {
				const text = el && typeof el.textContent === 'string' ? el.textContent : '';
				return !!text && text.length > 0;
			});
		});
	}

	async selectModel(modelName: string, timeoutMs: number = 60_000): Promise<void> {
		const page = this.code.driver.currentPage;
		const nameButton = page.locator(`${CHAT_MODEL_PICKER_NAME}:visible`).first();
		const row = page.locator(ACTION_WIDGET_ROW, { hasText: modelName }).first();
		const deadline = Date.now() + timeoutMs;
		let lastError: unknown;

		while (Date.now() < deadline) {
			try {
				await nameButton.click();
				await this.code.waitForElement(ACTION_WIDGET);
				await page.keyboard.type(modelName);
				await row.waitFor({ state: 'visible', timeout: 10_000 });
				await row.click({ force: true });
				await page.locator(`${CHAT_MODEL_PICKER_NAME}[aria-label*="${modelName}"]:visible`)
					.first()
					.waitFor({ state: 'visible', timeout: 10_000 });
				return;
			} catch (error) {
				lastError = error;
				try { await page.keyboard.press('Escape'); } catch { }
				await new Promise(r => setTimeout(r, 500));
			}
		}
		throw new Error(`Timed out selecting model "${modelName}". Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
	}

	private async ensureModelPickerExpanded(timeoutMs: number = 20_000): Promise<void> {
		const page = this.code.driver.currentPage;
		const configButton = page.locator(`${CHAT_MODEL_PICKER_CONFIG}:visible`).first();
		const auxBar = page.locator(AUXILIARYBAR_PART).first();
		const deadline = Date.now() + timeoutMs;

		while (Date.now() < deadline) {
			if (await configButton.isVisible().catch(() => false)) {
				await page.mouse.move(0, 0).catch(() => { });
				return;
			}

			const box = await auxBar.boundingBox().catch(() => null);
			if (box) {
				const sashX = box.x;
				const sashY = box.y + Math.min(box.height / 2, 200);
				await page.mouse.move(sashX, sashY);
				await page.mouse.down();
				await page.mouse.move(sashX - 20, sashY);
				await page.mouse.move(sashX - 160, sashY);
				await page.mouse.up();
			}

			await new Promise(r => setTimeout(r, 300));
		}
	}

	async openModelConfig(timeoutMs: number = 30_000): Promise<void> {
		const page = this.code.driver.currentPage;
		const configButton = page.locator(`${CHAT_MODEL_PICKER_CONFIG}:visible`).first();
		const anyRow = page.locator(`${ACTION_WIDGET_ROW}:visible`).first();
		const deadline = Date.now() + timeoutMs;
		let lastError: unknown;

		await this.dismissContextUsageDetails();

		await this.ensureModelPickerExpanded();

		while (Date.now() < deadline) {
			try {
				await configButton.waitFor({ state: 'visible', timeout: 15_000 });
				await configButton.click({ force: true });
				await this.code.waitForElement(ACTION_WIDGET);
				await anyRow.waitFor({ state: 'visible', timeout: 5_000 });
				return;
			} catch (error) {
				lastError = error;
				try {
					await page.keyboard.press('Escape');
				} catch { }
				await new Promise(r => setTimeout(r, 250));
			}
		}
		throw new Error(`Timed out opening the model configuration dropdown. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
	}

	async selectModelConfigOption(label: string, timeoutMs: number = 30_000): Promise<void> {
		const page = this.code.driver.currentPage;
		const row = page.locator(ACTION_WIDGET_ROW, { hasText: label }).first();
		const deadline = Date.now() + timeoutMs;
		let lastError: unknown;

		while (Date.now() < deadline) {
			try {
				await row.waitFor({ state: 'visible', timeout: 5_000 });
				await row.click({ force: true });
				await row.locator('.codicon-check').waitFor({ state: 'visible', timeout: 15_000 });
				return;
			} catch (error) {
				lastError = error;
				try {
					await this.openModelConfig(Math.max(5_000, deadline - Date.now()));
				} catch { }
			}
		}
		throw new Error(`Timed out selecting model config option "${label}". Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
	}

	async closeModelConfig(): Promise<void> {
		const page = this.code.driver.currentPage;
		await page.keyboard.press('Escape');
		await page.waitForFunction(
			(sel: string) => { const c = document.querySelector(sel); return !c || c.getAttribute('aria-expanded') !== 'true'; },
			CHAT_MODEL_PICKER_CONFIG,
			{ timeout: 15_000 },
		);
		await page.locator(`${ACTION_WIDGET_ROW}:visible`).first()
			.waitFor({ state: 'hidden', timeout: 5_000 })
			.catch(() => { });
	}

	async getModelConfigLabel(): Promise<string> {
		const page = this.code.driver.currentPage;
		const button = page.locator(`${CHAT_MODEL_PICKER_CONFIG}:visible`).first();
		await button.waitFor({ state: 'visible', timeout: 15_000 });
		return ((await button.textContent()) ?? '').trim();
	}

	async readContextUsageTokenLabel(timeoutMs: number = 30_000): Promise<string> {
		const page = this.code.driver.currentPage;
		const widget = page.locator(`${CHAT_CONTEXT_USAGE_WIDGET}:visible`).first();
		await widget.waitFor({ state: 'visible', timeout: timeoutMs });
		const label = page.locator(CONTEXT_USAGE_TOKEN_LABEL).first();
		const deadline = Date.now() + timeoutMs;
		let lastError: unknown;
		while (Date.now() < deadline) {
			try {
				const box = await widget.boundingBox();
				if (!box) {
					throw new Error('context-usage gauge has no bounding box');
				}
				await page.mouse.move(0, 0);
				await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
				await label.waitFor({ state: 'visible', timeout: 5_000 });
				const text = (await label.textContent()) ?? '';
				await this.dismissContextUsageDetails();
				return text.trim();
			} catch (error) {
				lastError = error;
				await this.dismissContextUsageDetails();
				await new Promise(r => setTimeout(r, 500));
			}
		}
		throw new Error(`Timed out reading the context-usage details token label. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
	}

	private async dismissContextUsageDetails(timeoutMs: number = 5_000): Promise<void> {
		const page = this.code.driver.currentPage;
		const details = page.locator(CONTEXT_USAGE_DETAILS);
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			try { await page.mouse.move(0, 0); } catch { }
			if (await details.count() === 0) {
				return;
			}
			await new Promise(r => setTimeout(r, 150));
		}
	}
}

export async function acceptToolConfirmationIfPresent(code: Code): Promise<void> {
	const allowButtonSelector = '.chat-confirmation-widget2 .monaco-button.monaco-text-button';
	try {
		const buttons = await code.driver.getElements(allowButtonSelector, true);
		if (!buttons || buttons.length === 0 || (buttons[0].textContent ?? '').trim() !== 'Allow') {
			return;
		}
		const allowButtons = code.driver.currentPage
			.locator('.chat-confirmation-widget2 .monaco-button.monaco-text-button')
			.filter({ hasText: /^Allow$/ });
		const total = await allowButtons.count();
		for (let i = 0; i < total; i++) {
			const b = allowButtons.nth(i);
			if (await b.isVisible()) {
				await b.click({ timeout: 2_000 });
				return;
			}
		}
	} catch {
	}
}

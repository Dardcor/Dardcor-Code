/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IPlaywrightService } from '../../../../../platform/browserView/common/playwrightService.js';

export interface IDardcorBrowserClickOptions {
	readonly button?: 'left' | 'right' | 'middle';
	readonly clickCount?: number;
	readonly selector?: string;
}

export interface IDardcorBrowserSnapshotEvidence {
	readonly url: string;
	readonly title: string;
	readonly visibleTextExcerpt: string;
	readonly dialogs?: readonly string[];
	readonly interactiveElements?: readonly {
		readonly tag: string;
		readonly type?: string;
		readonly role?: string;
		readonly text: string;
		readonly value?: string;
		readonly placeholder?: string;
		readonly href?: string;
		readonly disabled?: boolean;
		readonly checked?: string;
		readonly selected?: string;
		readonly expanded?: string;
		readonly pressed?: string;
	}[];
}

export function getDardcorBrowserSnapshotChanges(
	before: IDardcorBrowserSnapshotEvidence,
	after: IDardcorBrowserSnapshotEvidence,
): string[] {
	const changes: string[] = [];
	if (before.url !== after.url) {
		changes.push('URL changed');
	}
	if (before.title !== after.title) {
		changes.push('title changed');
	}
	if (before.visibleTextExcerpt !== after.visibleTextExcerpt) {
		changes.push('visible DOM text changed');
	}
	const interactiveState = (snapshot: IDardcorBrowserSnapshotEvidence) => (snapshot.interactiveElements ?? []).map(element => ({
		tag: element.tag,
		type: element.type,
		role: element.role,
		text: element.text,
		value: element.value,
		placeholder: element.placeholder,
		href: element.href,
		disabled: element.disabled,
		checked: element.checked,
		selected: element.selected,
		expanded: element.expanded,
		pressed: element.pressed,
	}));
	if (JSON.stringify(interactiveState(before)) !== JSON.stringify(interactiveState(after))) {
		changes.push('interactive control state changed');
	}
	if (JSON.stringify(before.dialogs ?? []) !== JSON.stringify(after.dialogs ?? [])) {
		changes.push('dialog state changed');
	}
	return changes;
}

export async function performDardcorBrowserClick(
	playwright: IPlaywrightService,
	sessionId: string,
	pageId: string,
	x: number,
	y: number,
	options: IDardcorBrowserClickOptions = {},
): Promise<void> {
	await playwright.startTrackingPage(pageId);
	if (!await playwright.isPageTracked(pageId)) {
		throw new Error(`Integrated browser page ${pageId} is not tracked by Playwright.`);
	}
	if (options.selector?.trim()) {
		await playwright.invokeFunctionRaw(
			sessionId,
			pageId,
			'async (page, selector, button, clickCount) => { const locator = page.locator(selector).first(); try { await locator.click({ button, clickCount, timeout: 3500, force: true }); } catch (_) { await page.evaluate(sel => { const el = document.querySelector(sel); if (el && typeof el.click === "function") el.click(); }, selector); } return true; }',
			options.selector,
			options.button ?? 'left',
			options.clickCount ?? 1,
		);
		return;
	}
	await playwright.invokeFunctionRaw(
		sessionId,
		pageId,
		'async (page, x, y, button, clickCount) => { await page.mouse.click(x, y, { button, clickCount }); return true; }',
		x,
		y,
		options.button ?? 'left',
		options.clickCount ?? 1,
	);
}

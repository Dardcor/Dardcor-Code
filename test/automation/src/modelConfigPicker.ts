/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as playwright from 'playwright';

export interface IModelConfigOption {
	readonly label: string;
	readonly description: string;
	readonly checked: boolean;
}

export interface IModelConfigSection {
	readonly header: string;
	readonly options: IModelConfigOption[];
}

export async function readModelConfigSections(page: playwright.Page, timeoutMs: number = 15_000): Promise<IModelConfigSection[]> {
	const widget = page.locator('.action-widget:visible').first();
	await widget.locator('.monaco-list-row.action').first().waitFor({ state: 'visible', timeout: timeoutMs });
	return widget.evaluate(element => {
		const rows = Array.from(element.querySelectorAll('.monaco-list-row'))
			.sort((a, b) => Number(a.getAttribute('data-index')) - Number(b.getAttribute('data-index')));
		const sections: { header: string; options: { label: string; description: string; checked: boolean }[] }[] = [];
		for (const row of rows) {
			if (row.classList.contains('group-header')) {
				sections.push({ header: (row.textContent ?? '').trim(), options: [] });
			} else if (row.classList.contains('action') && sections.length) {
				sections[sections.length - 1].options.push({
					label: (row.querySelector('.title')?.textContent ?? '').trim(),
					description: (row.querySelector('.description')?.textContent ?? '').trim(),
					checked: !!row.querySelector('.codicon-check'),
				});
			}
		}
		return sections;
	});
}

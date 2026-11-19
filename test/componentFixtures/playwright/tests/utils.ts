/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Page } from '@playwright/test';

function getBaseURL(): string {
	const port = process.env['COMPONENT_EXPLORER_PORT'];
	if (!port) {
		throw new Error('COMPONENT_EXPLORER_PORT is not set. Is the webServer running?');
	}
	return `http://localhost:${port}`;
}

export async function openFixture(page: Page, fixtureId: string, waitForSelector = '.image-carousel-editor'): Promise<void> {
	const url = `${getBaseURL()}/___explorer?mode=embedded&fixture=${encodeURIComponent(fixtureId)}`;
	await page.goto(url, { waitUntil: 'load' });
	await page.locator(waitForSelector).waitFor({ state: 'visible', timeout: 20_000 });
}

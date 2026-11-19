/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { escapeMarkdownSyntaxTokens, MarkdownString } from '../../../../../base/common/htmlContent.js';
import { localize } from '../../../../../nls.js';
import { IPlaywrightService } from '../../../../../platform/browserView/common/playwrightService.js';
import { ToolDataSource, type CountTokensCallback, type IPreparedToolInvocation, type IToolData, type IToolImpl, type IToolInvocation, type IToolInvocationPreparationContext, type IToolResult, type ToolProgress } from '../../../chat/common/tools/languageModelToolsService.js';
import { createBrowserPageLink, DEFAULT_ELEMENT_LABEL, errorResult, getSessionId, playwrightInvoke, resolveTargetSelector } from './browserToolHelpers.js';
import { BrowserChatToolReferenceName } from '../../../../../platform/browserView/common/browserChatToolReferenceNames.js';
import { OpenPageToolId } from './openBrowserTool.js';

export const ScrollBrowserToolData: IToolData = {
	id: 'scroll_browser_page',
	toolReferenceName: BrowserChatToolReferenceName.ScrollPage,
	displayName: localize('scrollBrowserTool.displayName', 'Scroll Browser Page'),
	userDescription: localize('scrollBrowserTool.userDescription', 'Scroll a browser page or an element into view'),
	modelDescription: 'Scroll a browser page up, down, left, right, to top/bottom, or scroll a specific element into view.',
	icon: Codicon.arrowDown,
	source: ToolDataSource.Internal,
	inputSchema: {
		type: 'object',
		properties: {
			pageId: {
				type: 'string',
				description: 'The browser page ID, acquired from context or the open tool.'
			},
			direction: {
				type: 'string',
				enum: ['up', 'down', 'left', 'right', 'top', 'bottom'],
				description: 'Direction to scroll. Default is "down".'
			},
			amount: {
				type: 'number',
				description: 'Number of pixels to scroll. Defaults to 500.'
			},
			ref: {
				type: 'string',
				description: 'Element reference to scroll into view.'
			},
			selector: {
				type: 'string',
				description: 'Playwright selector of the element to scroll into view.'
			},
			element: {
				type: 'string',
				description: 'Human-readable description of the element to scroll into view.'
			},
		},
		required: ['pageId'],
	},
};

interface IScrollBrowserToolParams {
	pageId: string;
	direction?: 'up' | 'down' | 'left' | 'right' | 'top' | 'bottom';
	amount?: number;
	ref?: string;
	selector?: string;
	element?: string;
}

export class ScrollBrowserTool implements IToolImpl {
	constructor(
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
	) { }

	async prepareToolInvocation(_context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const params = _context.parameters as IScrollBrowserToolParams;
		const link = createBrowserPageLink(params.pageId);
		if (params.ref || params.selector) {
			const element = escapeMarkdownSyntaxTokens(params.element ?? DEFAULT_ELEMENT_LABEL);
			return {
				invocationMessage: new MarkdownString(localize('browser.scrollElement.invocation', "Scrolling {0} into view in {1}", element, link)),
				pastTenseMessage: new MarkdownString(localize('browser.scrollElement.past', "Scrolled {0} into view in {1}", element, link)),
			};
		}
		const dir = params.direction ?? 'down';
		return {
			invocationMessage: new MarkdownString(localize('browser.scroll.invocation', "Scrolling {0} in {1}", dir, link)),
			pastTenseMessage: new MarkdownString(localize('browser.scroll.past', "Scrolled {0} in {1}", dir, link)),
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as IScrollBrowserToolParams;
		const sessionId = getSessionId(invocation);

		if (!params.pageId) {
			return errorResult(`No page ID provided. Use '${OpenPageToolId}' first.`);
		}

		const selector = resolveTargetSelector(params.ref, params.selector);
		const direction = params.direction ?? 'down';
		const amount = params.amount ?? 500;

		return playwrightInvoke(this.playwrightService, sessionId, params.pageId, async (page, sel, dir, px) => {
			if (sel) {
				const locator = page.locator(sel).first();
				await locator.scrollIntoViewIfNeeded();
				return { scrolled: true, target: sel };
			}

			if (dir === 'top') {
				await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
			} else if (dir === 'bottom') {
				await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
			} else if (dir === 'up') {
				await page.evaluate((y) => window.scrollBy({ top: -y, behavior: 'smooth' }), px);
			} else if (dir === 'down') {
				await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), px);
			} else if (dir === 'left') {
				await page.evaluate((x) => window.scrollBy({ left: -x, behavior: 'smooth' }), px);
			} else if (dir === 'right') {
				await page.evaluate((x) => window.scrollBy({ left: x, behavior: 'smooth' }), px);
			}

			await page.waitForTimeout(150);
			return { scrolled: true, direction: dir, amount: px };
		}, selector, direction, amount);
	}
}

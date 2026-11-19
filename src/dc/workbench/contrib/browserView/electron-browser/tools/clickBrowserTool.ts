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

export const ClickBrowserToolData: IToolData = {
	id: 'click_element',
	toolReferenceName: BrowserChatToolReferenceName.ClickElement,
	displayName: localize('clickBrowserTool.displayName', 'Click Element'),
	userDescription: localize('clickBrowserTool.userDescription', 'Click an element in a browser page'),
	modelDescription: 'Click on an element in a browser page.',
	icon: Codicon.cursor,
	source: ToolDataSource.Internal,
	inputSchema: {
		type: 'object',
		properties: {
			pageId: {
				type: 'string',
				description: `The browser page ID, acquired from context or the open tool.`
			},
			ref: {
				type: 'string',
				description: 'Element reference to click.'
			},
			selector: {
				type: 'string',
				description: 'Playwright selector of the element to click when "ref" is not available.'
			},
			element: {
				type: 'string',
				description: 'Human-readable description of the element to click (e.g., "submit button", "search icon").'
			},
			dblClick: {
				type: 'boolean',
				description: 'Set to true for double clicks. Default is false.'
			},
			button: {
				type: 'string',
				enum: ['left', 'right', 'middle'],
				description: 'Mouse button to click with. Default is "left".'
			},
		},
		required: ['pageId', 'element'],
		$comment: 'One of "ref" or "selector" is required.',
	},
};

interface IClickBrowserToolParams {
	pageId: string;
	ref?: string;
	selector?: string;
	element?: string;
	dblClick?: boolean;
	button?: 'left' | 'right' | 'middle';
}

export class ClickBrowserTool implements IToolImpl {
	constructor(
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
	) { }

	async prepareToolInvocation(_context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const params = _context.parameters as IClickBrowserToolParams;
		const link = createBrowserPageLink(params.pageId);
		const element = escapeMarkdownSyntaxTokens(params.element ?? DEFAULT_ELEMENT_LABEL);
		return {
			invocationMessage: params.button === 'right'
				? new MarkdownString(localize('browser.click.invocation.right', "Right-clicking {0} in {1}", element, link))
				: params.button === 'middle'
					? new MarkdownString(localize('browser.click.invocation.middle', "Middle-clicking {0} in {1}", element, link))
					: params.dblClick
						? new MarkdownString(localize('browser.dblClick.invocation', "Double-clicking {0} in {1}", element, link))
						: new MarkdownString(localize('browser.click.invocation', "Clicking {0} in {1}", element, link)),
			pastTenseMessage: params.button === 'right'
				? new MarkdownString(localize('browser.click.past.right', "Right-clicked {0} in {1}", element, link))
				: params.button === 'middle'
					? new MarkdownString(localize('browser.click.past.middle', "Middle-clicked {0} in {1}", element, link))
					: params.dblClick
						? new MarkdownString(localize('browser.dblClick.past', "Double-clicked {0} in {1}", element, link))
						: new MarkdownString(localize('browser.click.past', "Clicked {0} in {1}", element, link)),
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as IClickBrowserToolParams;
		const sessionId = getSessionId(invocation);

		if (!params.pageId) {
			return errorResult(`No page ID provided. Use '${OpenPageToolId}' first.`);
		}

		const selector = resolveTargetSelector(params.ref, params.selector);

		if (!selector) {
			return errorResult('Either a "ref" or "selector" parameter is required.');
		}

		const button = params.button ?? 'left';

		return playwrightInvoke(this.playwrightService, sessionId, params.pageId, async (page, sel, btn) => {
			const locator = page.locator(sel).first();
			const box = await locator.boundingBox().catch(() => null);
			if (box) {
				const targetX = Math.round(box.x + box.width / 2);
				const targetY = Math.round(box.y + box.height / 2);
				const distance = Math.hypot(targetX, targetY);
				const steps = Math.min(45, Math.max(12, Math.ceil(distance / 20)));
				await page.mouse.move(targetX, targetY, { steps }).catch(() => {});
				await new Promise(r => setTimeout(r, 60));
			}
			return params.dblClick ? locator.dblclick({ button: btn }) : locator.click({ button: btn });
		}, selector, button);
	}
}

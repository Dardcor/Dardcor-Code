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

export const PressKeyBrowserToolData: IToolData = {
	id: 'press_browser_key',
	toolReferenceName: BrowserChatToolReferenceName.PressKey,
	displayName: localize('pressKeyBrowserTool.displayName', 'Press Key'),
	userDescription: localize('pressKeyBrowserTool.userDescription', 'Press a keyboard key or shortcut in a browser page'),
	modelDescription: 'Press a keyboard key or shortcut combination (e.g., "Enter", "Tab", "Escape", "ArrowDown", "Control+a") in the browser.',
	icon: Codicon.keyboard,
	source: ToolDataSource.Internal,
	inputSchema: {
		type: 'object',
		properties: {
			pageId: {
				type: 'string',
				description: 'The browser page ID, acquired from context or the open tool.'
			},
			key: {
				type: 'string',
				description: 'Key or shortcut to press (e.g., "Enter", "Tab", "Escape", "Control+v").'
			},
			ref: {
				type: 'string',
				description: 'Optional element reference to focus before pressing key.'
			},
			selector: {
				type: 'string',
				description: 'Optional Playwright selector of element to focus before pressing key.'
			},
			element: {
				type: 'string',
				description: 'Human-readable description of element to focus.'
			},
		},
		required: ['pageId', 'key'],
	},
};

interface IPressKeyBrowserToolParams {
	pageId: string;
	key: string;
	ref?: string;
	selector?: string;
	element?: string;
}

export class PressKeyBrowserTool implements IToolImpl {
	constructor(
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
	) { }

	async prepareToolInvocation(_context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const params = _context.parameters as IPressKeyBrowserToolParams;
		const link = createBrowserPageLink(params.pageId);
		const key = escapeMarkdownSyntaxTokens(params.key);
		if (params.ref || params.selector) {
			const element = escapeMarkdownSyntaxTokens(params.element ?? DEFAULT_ELEMENT_LABEL);
			return {
				invocationMessage: new MarkdownString(localize('browser.pressKeyTarget.invocation', "Pressing `{0}` on {1} in {2}", key, element, link)),
				pastTenseMessage: new MarkdownString(localize('browser.pressKeyTarget.past', "Pressed `{0}` on {1} in {2}", key, element, link)),
			};
		}
		return {
			invocationMessage: new MarkdownString(localize('browser.pressKeyGlobal.invocation', "Pressing `{0}` in {1}", key, link)),
			pastTenseMessage: new MarkdownString(localize('browser.pressKeyGlobal.past', "Pressed `{0}` in {1}", key, link)),
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as IPressKeyBrowserToolParams;
		const sessionId = getSessionId(invocation);

		if (!params.pageId) {
			return errorResult(`No page ID provided. Use '${OpenPageToolId}' first.`);
		}

		const selector = resolveTargetSelector(params.ref, params.selector);

		return playwrightInvoke(this.playwrightService, sessionId, params.pageId, async (page, sel, k) => {
			if (sel) {
				const locator = page.locator(sel).first();
				await locator.focus();
				await locator.press(k);
			} else {
				await page.keyboard.press(k);
			}
			return { pressed: k };
		}, selector, params.key);
	}
}

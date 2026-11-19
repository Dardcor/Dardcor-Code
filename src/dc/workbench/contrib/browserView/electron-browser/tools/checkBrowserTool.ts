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

export const CheckBrowserToolData: IToolData = {
	id: 'check_browser_element',
	toolReferenceName: BrowserChatToolReferenceName.CheckElement,
	displayName: localize('checkBrowserTool.displayName', 'Check/Uncheck Element'),
	userDescription: localize('checkBrowserTool.userDescription', 'Check or uncheck a checkbox or radio button'),
	modelDescription: 'Check or uncheck a checkbox or radio button in a browser page.',
	icon: Codicon.check,
	source: ToolDataSource.Internal,
	inputSchema: {
		type: 'object',
		properties: {
			pageId: {
				type: 'string',
				description: 'The browser page ID, acquired from context or the open tool.'
			},
			checked: {
				type: 'boolean',
				description: 'Whether to check (true) or uncheck (false) the element. Defaults to true.'
			},
			ref: {
				type: 'string',
				description: 'Element reference of the checkbox/radio.'
			},
			selector: {
				type: 'string',
				description: 'Playwright selector of the checkbox/radio.'
			},
			element: {
				type: 'string',
				description: 'Human-readable description of the element (e.g. "remember me checkbox").'
			},
		},
		required: ['pageId'],
	},
};

interface ICheckBrowserToolParams {
	pageId: string;
	checked?: boolean;
	ref?: string;
	selector?: string;
	element?: string;
}

export class CheckBrowserTool implements IToolImpl {
	constructor(
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
	) { }

	async prepareToolInvocation(_context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const params = _context.parameters as ICheckBrowserToolParams;
		const link = createBrowserPageLink(params.pageId);
		const element = escapeMarkdownSyntaxTokens(params.element ?? DEFAULT_ELEMENT_LABEL);
		const willCheck = params.checked !== false;
		return {
			invocationMessage: new MarkdownString(willCheck
				? localize('browser.check.invocation', "Checking {0} in {1}", element, link)
				: localize('browser.uncheck.invocation', "Unchecking {0} in {1}", element, link)),
			pastTenseMessage: new MarkdownString(willCheck
				? localize('browser.check.past', "Checked {0} in {1}", element, link)
				: localize('browser.uncheck.past', "Unchecked {0} in {1}", element, link)),
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as ICheckBrowserToolParams;
		const sessionId = getSessionId(invocation);

		if (!params.pageId) {
			return errorResult(`No page ID provided. Use '${OpenPageToolId}' first.`);
		}

		const selector = resolveTargetSelector(params.ref, params.selector);
		if (!selector) {
			return errorResult('Either a "ref" or "selector" parameter is required.');
		}

		const shouldCheck = params.checked !== false;

		return playwrightInvoke(this.playwrightService, sessionId, params.pageId, async (page, sel, chk) => {
			const locator = page.locator(sel).first();
			if (chk) {
				await locator.check();
			} else {
				await locator.uncheck();
			}
			return { checked: chk };
		}, selector, shouldCheck);
	}
}

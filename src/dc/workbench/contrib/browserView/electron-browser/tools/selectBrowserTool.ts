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

export const SelectBrowserToolData: IToolData = {
	id: 'select_browser_option',
	toolReferenceName: BrowserChatToolReferenceName.SelectOption,
	displayName: localize('selectBrowserTool.displayName', 'Select Option'),
	userDescription: localize('selectBrowserTool.userDescription', 'Select one or more options in a dropdown or select element'),
	modelDescription: 'Select an option in a dropdown or <select> element in a browser page by value or visible label.',
	icon: Codicon.listSelection,
	source: ToolDataSource.Internal,
	inputSchema: {
		type: 'object',
		properties: {
			pageId: {
				type: 'string',
				description: 'The browser page ID, acquired from context or the open tool.'
			},
			values: {
				type: 'array',
				items: { type: 'string' },
				description: 'Option values or labels to select.'
			},
			ref: {
				type: 'string',
				description: 'Element reference of the select element.'
			},
			selector: {
				type: 'string',
				description: 'Playwright selector of the select element.'
			},
			element: {
				type: 'string',
				description: 'Human-readable description of the dropdown element.'
			},
		},
		required: ['pageId', 'values'],
	},
};

interface ISelectBrowserToolParams {
	pageId: string;
	values: string[];
	ref?: string;
	selector?: string;
	element?: string;
}

export class SelectBrowserTool implements IToolImpl {
	constructor(
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
	) { }

	async prepareToolInvocation(_context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const params = _context.parameters as ISelectBrowserToolParams;
		const link = createBrowserPageLink(params.pageId);
		const element = escapeMarkdownSyntaxTokens(params.element ?? DEFAULT_ELEMENT_LABEL);
		const vals = params.values.join(', ');
		return {
			invocationMessage: new MarkdownString(localize('browser.select.invocation', "Selecting `{0}` in {1} in {2}", vals, element, link)),
			pastTenseMessage: new MarkdownString(localize('browser.select.past', "Selected `{0}` in {1} in {2}", vals, element, link)),
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as ISelectBrowserToolParams;
		const sessionId = getSessionId(invocation);

		if (!params.pageId) {
			return errorResult(`No page ID provided. Use '${OpenPageToolId}' first.`);
		}

		const selector = resolveTargetSelector(params.ref, params.selector);
		if (!selector) {
			return errorResult('Either a "ref" or "selector" parameter is required.');
		}

		return playwrightInvoke(this.playwrightService, sessionId, params.pageId, async (page, sel, vals) => {
			const locator = page.locator(sel).first();
			const selected = await locator.selectOption(vals);
			return { selected };
		}, selector, params.values);
	}
}

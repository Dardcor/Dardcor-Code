/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { localize } from '../../../../../nls.js';
import { IPlaywrightService } from '../../../../../platform/browserView/common/playwrightService.js';
import { ToolDataSource, type CountTokensCallback, type IPreparedToolInvocation, type IToolData, type IToolImpl, type IToolInvocation, type IToolInvocationPreparationContext, type IToolResult, type ToolProgress } from '../../../chat/common/tools/languageModelToolsService.js';
import { createBrowserPageLink, errorResult, getSessionId, playwrightInvoke, resolveTargetSelector } from './browserToolHelpers.js';
import { BrowserChatToolReferenceName } from '../../../../../platform/browserView/common/browserChatToolReferenceNames.js';
import { OpenPageToolId } from './openBrowserTool.js';

export const EvalBrowserToolData: IToolData = {
	id: 'eval_in_browser',
	toolReferenceName: BrowserChatToolReferenceName.EvalInPage,
	displayName: localize('evalBrowserTool.displayName', 'Evaluate JavaScript in Browser'),
	userDescription: localize('evalBrowserTool.userDescription', 'Evaluate JavaScript in the page or element context'),
	modelDescription: 'Evaluate a JavaScript expression or function in the browser page context and return the serialized result.',
	icon: Codicon.code,
	source: ToolDataSource.Internal,
	inputSchema: {
		type: 'object',
		properties: {
			pageId: {
				type: 'string',
				description: 'The browser page ID, acquired from context or the open tool.'
			},
			script: {
				type: 'string',
				description: 'JavaScript code or expression to evaluate.'
			},
			ref: {
				type: 'string',
				description: 'Optional element reference to pass as target element to script.'
			},
			selector: {
				type: 'string',
				description: 'Optional Playwright selector of target element.'
			},
		},
		required: ['pageId', 'script'],
	},
};

interface IEvalBrowserToolParams {
	pageId: string;
	script: string;
	ref?: string;
	selector?: string;
}

export class EvalBrowserTool implements IToolImpl {
	constructor(
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
	) { }

	async prepareToolInvocation(_context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const params = _context.parameters as IEvalBrowserToolParams;
		const link = createBrowserPageLink(params.pageId);
		return {
			invocationMessage: new MarkdownString(localize('browser.eval.invocation', "Evaluating JavaScript in {0}", link)),
			pastTenseMessage: new MarkdownString(localize('browser.eval.past', "Evaluated JavaScript in {0}", link)),
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as IEvalBrowserToolParams;
		const sessionId = getSessionId(invocation);

		if (!params.pageId) {
			return errorResult(`No page ID provided. Use '${OpenPageToolId}' first.`);
		}

		const selector = resolveTargetSelector(params.ref, params.selector);

		return playwrightInvoke(this.playwrightService, sessionId, params.pageId, async (page, sel, code) => {
			if (sel) {
				const locator = page.locator(sel).first();
				return locator.evaluate((el, scriptStr) => {
					const fn = new Function('element', `"use strict"; return (${scriptStr});`);
					return fn(el);
				}, code);
			}

			return page.evaluate((scriptStr) => {
				const fn = new Function(`"use strict"; return (${scriptStr});`);
				return fn();
			}, code);
		}, selector, params.script);
	}
}

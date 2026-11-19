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

export const WaitBrowserToolData: IToolData = {
	id: 'wait_browser',
	toolReferenceName: BrowserChatToolReferenceName.WaitPage,
	displayName: localize('waitBrowserTool.displayName', 'Wait in Browser'),
	userDescription: localize('waitBrowserTool.userDescription', 'Wait for time, an element state, or network idle'),
	modelDescription: 'Wait for a specified duration in milliseconds, for an element to appear/disappear, or for network idle.',
	icon: Codicon.watch,
	source: ToolDataSource.Internal,
	inputSchema: {
		type: 'object',
		properties: {
			pageId: {
				type: 'string',
				description: 'The browser page ID, acquired from context or the open tool.'
			},
			durationMs: {
				type: 'number',
				description: 'Duration to sleep in milliseconds.'
			},
			state: {
				type: 'string',
				enum: ['visible', 'hidden', 'attached', 'detached', 'networkidle', 'load'],
				description: 'State to wait for. Defaults to "visible" when selector/ref is provided.'
			},
			ref: {
				type: 'string',
				description: 'Element reference to wait for.'
			},
			selector: {
				type: 'string',
				description: 'Playwright selector of element to wait for.'
			},
			timeoutMs: {
				type: 'number',
				description: 'Maximum time to wait before timing out (defaults to 10000ms).'
			},
		},
		required: ['pageId'],
	},
};

interface IWaitBrowserToolParams {
	pageId: string;
	durationMs?: number;
	state?: 'visible' | 'hidden' | 'attached' | 'detached' | 'networkidle' | 'load';
	ref?: string;
	selector?: string;
	timeoutMs?: number;
}

export class WaitBrowserTool implements IToolImpl {
	constructor(
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
	) { }

	async prepareToolInvocation(_context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const params = _context.parameters as IWaitBrowserToolParams;
		const link = createBrowserPageLink(params.pageId);
		return {
			invocationMessage: new MarkdownString(localize('browser.wait.invocation', "Waiting in {0}", link)),
			pastTenseMessage: new MarkdownString(localize('browser.wait.past', "Finished waiting in {0}", link)),
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as IWaitBrowserToolParams;
		const sessionId = getSessionId(invocation);

		if (!params.pageId) {
			return errorResult(`No page ID provided. Use '${OpenPageToolId}' first.`);
		}

		const selector = resolveTargetSelector(params.ref, params.selector);
		const timeout = params.timeoutMs ?? 10000;

		return playwrightInvoke(this.playwrightService, sessionId, params.pageId, async (page, sel, dur, st, to) => {
			if (dur && dur > 0) {
				await page.waitForTimeout(Math.min(dur, 30000));
				return { waitedMs: dur };
			}

			if (st === 'networkidle') {
				await page.waitForLoadState('networkidle', { timeout: to });
				return { waitedState: 'networkidle' };
			}

			if (st === 'load') {
				await page.waitForLoadState('load', { timeout: to });
				return { waitedState: 'load' };
			}

			if (sel) {
				const targetState = (st === 'hidden' || st === 'detached') ? st : 'visible';
				await page.locator(sel).first().waitFor({ state: targetState, timeout: to });
				return { waitedElement: sel, state: targetState };
			}

			await page.waitForTimeout(1000);
			return { waitedMs: 1000 };
		}, selector, params.durationMs, params.state, timeout);
	}
}

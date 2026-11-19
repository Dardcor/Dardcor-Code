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

export const DragElementToolData: IToolData = {
	id: 'drag_element',
	toolReferenceName: BrowserChatToolReferenceName.DragElement,
	displayName: localize('dragElementTool.displayName', 'Drag Element'),
	userDescription: localize('dragElementTool.userDescription', 'Drag an element over another element'),
	modelDescription: 'Drag an element over another element in a browser page.',
	icon: Codicon.move,
	source: ToolDataSource.Internal,
	inputSchema: {
		type: 'object',
		properties: {
			pageId: {
				type: 'string',
				description: `The browser page ID, acquired from context or the open tool.`
			},
			fromRef: {
				type: 'string',
				description: 'Element reference to drag from.'
			},
			fromSelector: {
				type: 'string',
				description: 'Playwright selector of the element to drag from when "fromRef" is not available.'
			},
			fromElement: {
				type: 'string',
				description: 'Human-readable description of the element to drag from (e.g., "item card", "draggable node").'
			},
			toRef: {
				type: 'string',
				description: 'Element reference to drag to.'
			},
			toSelector: {
				type: 'string',
				description: 'Playwright selector of the element to drag to when "toRef" is not available.'
			},
			toElement: {
				type: 'string',
				description: 'Human-readable description of the element to drag to (e.g., "drop zone", "target column").'
			},
		},
		required: ['pageId', 'fromElement', 'toElement'],
		$comment: 'One of "fromRef" or "fromSelector" is required, and one of "toRef" or "toSelector" is required.',
	},
};

interface IDragElementToolParams {
	pageId: string;
	fromRef?: string;
	fromSelector?: string;
	fromElement?: string;
	toRef?: string;
	toSelector?: string;
	toElement?: string;
}

export class DragElementTool implements IToolImpl {
	constructor(
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
	) { }

	async prepareToolInvocation(_context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const params = _context.parameters as IDragElementToolParams;
		const link = createBrowserPageLink(params.pageId);
		const fromElement = escapeMarkdownSyntaxTokens(params.fromElement ?? DEFAULT_ELEMENT_LABEL);
		const toElement = escapeMarkdownSyntaxTokens(params.toElement ?? DEFAULT_ELEMENT_LABEL);
		return {
			invocationMessage: new MarkdownString(localize('browser.drag.invocation', "Dragging {0} to {1} in {2}", fromElement, toElement, link)),
			pastTenseMessage: new MarkdownString(localize('browser.drag.past', "Dragged {0} to {1} in {2}", fromElement, toElement, link)),
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		const params = invocation.parameters as IDragElementToolParams;
		const sessionId = getSessionId(invocation);

		if (!params.pageId) {
			return errorResult(`No page ID provided. Use '${OpenPageToolId}' first.`);
		}

		const fromSelector = resolveTargetSelector(params.fromRef, params.fromSelector);
		if (!fromSelector) {
			return errorResult('Either a "fromRef" or "fromSelector" parameter is required for the source element.');
		}

		const toSelector = resolveTargetSelector(params.toRef, params.toSelector);
		if (!toSelector) {
			return errorResult('Either a "toRef" or "toSelector" parameter is required for the target element.');
		}

		return playwrightInvoke(this.playwrightService, sessionId, params.pageId, (page, from, to) => page.dragAndDrop(from, to), fromSelector, toSelector);
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import { Button } from '../../../../../../../base/browser/ui/button/button.js';
import { Codicon } from '../../../../../../../base/common/codicons.js';
import { Event } from '../../../../../../../base/common/event.js';
import { MarkdownString } from '../../../../../../../base/common/htmlContent.js';
import { MutableDisposable } from '../../../../../../../base/common/lifecycle.js';
import { autorun, observableValue } from '../../../../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../../../../base/common/themables.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { localize } from '../../../../../../../nls.js';
import { IInstantiationService } from '../../../../../../../platform/instantiation/common/instantiation.js';
import { IMarkdownRendererService } from '../../../../../../../platform/markdown/browser/markdownRenderer.js';
import { defaultButtonStyles } from '../../../../../../../platform/theme/browser/defaultStyles.js';
import { ChatErrorLevel, ChatMcpAppData, IChatToolInvocation, IChatToolInvocationSerialized } from '../../../../common/chatService/chatService.js';
import { IChatCodeBlockInfo } from '../../../chat.js';
import { IChatContentPartRenderContext } from '../chatContentParts.js';
import { ChatErrorWidget } from '../chatErrorContentPart.js';
import { ChatProgressSubPart } from '../chatProgressContentPart.js';
import { ChatResourceGroupWidget } from '../chatResourceGroupWidget.js';
import { ChatMcpAppModel, McpAppLoadState } from './chatMcpAppModel.js';
import { BaseChatToolInvocationSubPart } from './chatToolInvocationSubPart.js';

export type IMcpAppRenderData = ChatMcpAppData & {
	readonly input: string;
	readonly sessionResource: URI;
};

const maxWebviewHeightPct = 0.75;

export class ChatMcpAppSubPart extends BaseChatToolInvocationSubPart {

	public readonly domNode: HTMLElement;
	public override readonly codeblocks: IChatCodeBlockInfo[] = [];

	private readonly _model: ChatMcpAppModel;

	private readonly _webviewContainer: HTMLElement;

	private readonly _progressPart = this._register(new MutableDisposable<ChatProgressSubPart>());

	private _errorNode: HTMLElement | undefined;

	private readonly _downloadContainer: HTMLElement;

	private readonly _downloadWidget = this._register(new MutableDisposable<ChatResourceGroupWidget>());

	constructor(
		toolInvocation: IChatToolInvocation | IChatToolInvocationSerialized,
		onDidRemount: Event<void>,
		context: IChatContentPartRenderContext,
		private readonly _renderData: IMcpAppRenderData,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IMarkdownRendererService private readonly _markdownRendererService: IMarkdownRendererService,
	) {
		super(toolInvocation);

		this.domNode = dom.$('div.mcp-app-part');
		this._webviewContainer = dom.$('div.mcp-app-webview');
		this._webviewContainer.style.maxHeight = `${maxWebviewHeightPct * 100}vh`;
		this._webviewContainer.style.minHeight = '100px';
		this._webviewContainer.style.height = '300px';
		this.domNode.appendChild(this._webviewContainer);

		this._downloadContainer = dom.$('div.mcp-app-downloads');
		this.domNode.appendChild(this._downloadContainer);

		const targetWindow = dom.getWindow(this.domNode);
		const getMaxHeight = () => maxWebviewHeightPct * targetWindow.innerHeight;
		const maxHeight = observableValue('mcpAppMaxHeight', getMaxHeight());
		dom.addDisposableListener(targetWindow, 'resize', () => maxHeight.set(getMaxHeight(), undefined));

		this._model = this._register(this._instantiationService.createInstance(
			ChatMcpAppModel,
			toolInvocation,
			this._renderData,
			this._webviewContainer,
			maxHeight,
			context.currentWidth,
		));

		this._updateContainerHeight();

		this._register(autorun(reader => {
			const loadState = this._model.loadState.read(reader);
			this._handleLoadStateChange(this._webviewContainer, loadState);
		}));

		this._register(this._model.onDidChangeHeight(() => {
			this._updateContainerHeight();
		}));

		this._register(autorun(reader => {
			const parts = this._model.downloadParts.read(reader);
			if (parts.length === 0) {
				this._downloadWidget.clear();
				dom.clearNode(this._downloadContainer);
				return;
			}

			dom.clearNode(this._downloadContainer);
			const widget = this._instantiationService.createInstance(ChatResourceGroupWidget, parts, undefined);
			this._downloadWidget.value = widget;
			this._downloadContainer.appendChild(widget.domNode);
		}));

		this._register(onDidRemount(() => {
			this._model.remount();
		}));

		this._register(context.onDidChangeVisibility(visible => {
			if (visible) {
				this._model.remount();
			}
		}));
	}

	private _handleLoadStateChange(container: HTMLElement, loadState: McpAppLoadState): void {
		if (this._progressPart.value) {
			this._progressPart.value.domNode.remove();
		}
		this._progressPart.clear();
		if (this._errorNode) {
			this._errorNode.remove();
			this._errorNode = undefined;
		}

		switch (loadState.status) {
			case 'loading': {
				container.style.display = 'none';

				const progressMessage = dom.$('span');
				progressMessage.textContent = localize('loadingMcpApp', 'Loading MCP App...');
				const progressPart = this._instantiationService.createInstance(
					ChatProgressSubPart,
					progressMessage,
					ThemeIcon.modify(Codicon.loading, 'spin'),
					undefined
				);
				this._progressPart.value = progressPart;
				this.domNode.appendChild(progressPart.domNode);
				break;
			}
			case 'loaded': {
				container.style.display = '';
				break;
			}
			case 'error': {
				container.style.display = 'none';
				this._showError(this.domNode, loadState.error);
				break;
			}
		}
	}

	private _updateContainerHeight(): void {
		this._webviewContainer.style.height = `${this._model.height}px`;
	}

	private _showError(container: HTMLElement, error: Error): void {
		const errorNode = dom.$('.mcp-app-error');

		const errorMessage = new MarkdownString();
		errorMessage.appendText(localize('mcpAppError', 'Error loading MCP App: {0}', error.message || String(error)));

		const errorWidget = this._register(new ChatErrorWidget(ChatErrorLevel.Error, errorMessage, this._markdownRendererService));
		errorNode.appendChild(errorWidget.domNode);

		const buttonContainer = dom.append(errorNode, dom.$('.chat-buttons-container'));
		const retryButton = this._register(new Button(buttonContainer, defaultButtonStyles));
		retryButton.label = localize('retry', 'Retry');
		this._register(retryButton.onDidClick(() => {
			this._model.retry();
		}));

		container.appendChild(errorNode);
		this._errorNode = errorNode;
	}
}

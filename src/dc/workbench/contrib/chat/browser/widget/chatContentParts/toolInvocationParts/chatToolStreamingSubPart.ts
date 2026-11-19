/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../../base/browser/dom.js';
import { IMarkdownString, MarkdownString } from '../../../../../../../base/common/htmlContent.js';
import { autorun } from '../../../../../../../base/common/observable.js';
import { IMarkdownRenderer } from '../../../../../../../platform/markdown/browser/markdownRenderer.js';
import { IInstantiationService } from '../../../../../../../platform/instantiation/common/instantiation.js';
import { IChatProgressMessage, IChatToolInvocation } from '../../../../common/chatService/chatService.js';
import { IChatCodeBlockInfo } from '../../../chat.js';
import { IChatContentPartRenderContext } from '../chatContentParts.js';
import { ChatProgressContentPart } from '../chatProgressContentPart.js';
import { BaseChatToolInvocationSubPart } from './chatToolInvocationSubPart.js';

export class ChatToolStreamingSubPart extends BaseChatToolInvocationSubPart {
	public readonly domNode: HTMLElement;

	public override readonly codeblocks: IChatCodeBlockInfo[] = [];

	constructor(
		toolInvocation: IChatToolInvocation,
		private readonly context: IChatContentPartRenderContext,
		private readonly renderer: IMarkdownRenderer,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super(toolInvocation);

		this.domNode = this.createStreamingPart();
	}

	private createStreamingPart(): HTMLElement {
		const container = document.createElement('div');

		if (this.toolInvocation.kind !== 'toolInvocation') {
			return container;
		}

		const toolInvocation = this.toolInvocation;
		const state = toolInvocation.state.get();
		if (state.type !== IChatToolInvocation.StateKind.Streaming) {
			return container;
		}

		this._register(autorun(reader => {
			const currentState = toolInvocation.state.read(reader);
			if (currentState.type !== IChatToolInvocation.StateKind.Streaming) {
				dom.clearNode(container);
				this._onNeedsRerender.fire();
				return;
			}

			const streamingMessage = currentState.streamingMessage.read(reader);
			const displayMessage = streamingMessage ?? toolInvocation.invocationMessage;

			const messageText = typeof displayMessage === 'string' ? displayMessage : displayMessage.value;
			if (!messageText || messageText.trim().length === 0) {
				dom.clearNode(container);
				return;
			}

			const content: IMarkdownString = typeof displayMessage === 'string'
				? new MarkdownString().appendText(displayMessage)
				: displayMessage;

			const progressMessage: IChatProgressMessage = {
				kind: 'progressMessage',
				content
			};

			const shimmer = !toolInvocation.isAttachedToThinking;
			const part = reader.store.add(this.instantiationService.createInstance(
				ChatProgressContentPart,
				progressMessage,
				this.renderer,
				this.context,
				shimmer ? true : undefined,
				true,
				this.getProgressIcon(),
				toolInvocation,
				shimmer
			));

			dom.reset(container, part.domNode);
		}));

		return container;
	}
}

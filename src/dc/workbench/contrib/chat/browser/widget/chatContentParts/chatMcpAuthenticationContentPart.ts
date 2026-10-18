/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { IRenderedMarkdown } from '../../../../../../base/browser/markdownRenderer.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { escapeMarkdownSyntaxTokens, MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { Disposable, IDisposable, MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import { autorun, observableValue } from '../../../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';

import { localize } from '../../../../../../nls.js';
import { McpServerStatus } from '../../../../../../platform/agentHost/common/state/protocol/state.js';
import { IMarkdownRendererService } from '../../../../../../platform/markdown/browser/markdownRenderer.js';
import { IChatMcpAuthenticationRequired, IChatMcpAuthenticationRequiredServer } from '../../../common/chatService/chatService.js';
import { ChatTreeItem } from '../../chat.js';
import { IChatRendererContent } from '../../../common/model/chatViewModel.js';
import { getCompactCodicon } from '../../chatIcons.js';
import { IChatContentPart } from './chatContentParts.js';
import './media/chatMcpServersInteractionContent.css';

export class ChatMcpAuthenticationContentPart extends Disposable implements IChatContentPart {
	public readonly domNode: HTMLElement;

	private readonly rendered = this._register(new MutableDisposable<IRenderedMarkdown>());

	private _hasBeenVisible = false;

	private readonly _authenticating = observableValue<IChatMcpAuthenticationRequiredServer | undefined>(this, undefined);

	constructor(
		private readonly data: IChatMcpAuthenticationRequired,
		@IMarkdownRendererService private readonly markdownRendererService: IMarkdownRendererService,
		
	) {
		super();
		this.domNode = dom.$('.chat-mcp-servers-interaction');
		this._register(autorun(reader => {
			const servers = this.data.servers.read(reader);
			const authenticating = this._authenticating.read(reader);
			this.render(servers, authenticating);
			this.updateVisibility(servers, authenticating);
		}));
		
	}

	private render(servers: readonly IChatMcpAuthenticationRequiredServer[], authenticating: IChatMcpAuthenticationRequiredServer | undefined): void {
		dom.clearNode(this.domNode);
		this.rendered.clear();

		if (authenticating) {
			this._renderMessage(
				ThemeIcon.modify(Codicon.loading, 'spin'),
				localize('mcp.auth.authenticating', 'Authenticating {0}...', '`' + escapeMarkdownSyntaxTokens(authenticating.name) + '`'),
			);
			return;
		}

		if (!servers.length) {
			return;
		}

		const links = servers
			.map(server => '`' + escapeMarkdownSyntaxTokens(server.name) + '`')
			.join(', ');
		const content = servers.length === 1
			? localize('mcp.auth.single', 'The MCP server {0} requires authentication. [Authenticate](#authenticate)?', links)
			: localize('mcp.auth.multiple', 'The MCP servers {0} require authentication. [Authenticate](#authenticate)?', links);
		this._renderMessage(Codicon.mcp, content, { href: '#authenticate', run: () => void this.authenticate() });
	}

	private _renderMessage(icon: ThemeIcon, content: string, action?: { href: string; run: () => void }): void {
		const container = dom.$('.chat-mcp-servers-interaction-hint');
		const messageContainer = dom.$('.chat-mcp-servers-message');
		const iconElement = dom.$('.chat-mcp-servers-icon');
		iconElement.classList.add(...ThemeIcon.asClassNameArray(getCompactCodicon(icon)));

		const rendered = this.rendered.value = this.markdownRendererService.render(new MarkdownString(content, { isTrusted: true }), action ? {
			actionHandler: (href: string) => {
				if (href !== action.href) {
					return Promise.resolve(false);
				}
				action.run();
				return Promise.resolve(true);
			},
		} : undefined);

		messageContainer.appendChild(iconElement);
		messageContainer.appendChild(rendered.element);
		container.appendChild(messageContainer);
		this.domNode.appendChild(container);

		if (action) {
			// eslint-disable-next-line no-restricted-syntax
			const actionLink = rendered.element.querySelector<HTMLAnchorElement>(`a[data-href="${action.href}"]`);
			if (actionLink) {
				actionLink.setAttribute('role', 'button');
				actionLink.href = '';
			}
		}
	}

	private async authenticate(): Promise<void> {
		try {
			for (const server of this.data.servers.get()) {
				this._authenticating.set(server, undefined);
				
			}
		} finally {
			this._authenticating.set(undefined, undefined);
		}
	}

	private updateVisibility(dataServers: readonly IChatMcpAuthenticationRequiredServer[], authenticating: IChatMcpAuthenticationRequiredServer | undefined): void {
		if (authenticating) {
			this.domNode.style.display = '';
			this._hasBeenVisible = true;
			return;
		}
		const servers: any[] = [];
		const visible = dataServers.some(server => servers.some(current => current.id === server.id && current.status === McpServerStatus.AuthRequired));
		this.domNode.style.display = visible ? '' : 'none';
		if (visible) {
			this._hasBeenVisible = true;
		} else if (this._hasBeenVisible) {
			this.data.isUsed = true;
		}
	}

	hasSameContent(other: IChatRendererContent, _followingContent: IChatRendererContent[], _element: ChatTreeItem): boolean {
		return other.kind === 'mcpAuthenticationRequired';
	}

	addDisposable(disposable: IDisposable): void {
		this._register(disposable);
	}
}

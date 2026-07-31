/**
 * Dardcor Code - Markdown Streaming LLM Chat Response Message Bubble Component
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, clearNode, addDisposableListener } from '../../core/dom/element.js';
import { escape } from '../../core/types/strings.js';

export type ChatMessageRole = 'user' | 'assistant' | 'system';

export interface IChatMessage {
	readonly id: string;
	readonly role: ChatMessageRole;
	readonly text: string;
	readonly timestamp: number;
	readonly error?: boolean;
}

export function createChatMessage(role: ChatMessageRole, text: string, id?: string): IChatMessage {
	return {
		id: id ?? `chat-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
		role,
		text,
		timestamp: Date.now()
	};
}

const ROLE_LABELS: Record<ChatMessageRole, string> = {
	user: 'Anda',
	assistant: 'Dardcor AI',
	system: 'Sistem'
};

export class ChatMessageRenderer extends Disposable {
	private readonly _onDidFinishStream = this._register(new Emitter<string>());
	readonly onDidFinishStream: Event<string> = this._onDidFinishStream.event;

	private _streamTimer: any = undefined;

	public render(container: HTMLElement, message: IChatMessage, streaming = false): HTMLElement {
		const bubble = $<HTMLElement>('div', 'dc-chat-bubble');
		bubble.style.cssText = `display:flex;flex-direction:column;gap:4px;padding:8px 12px;max-width:92%;border-radius:8px;align-self:${message.role === 'user' ? 'flex-end' : 'flex-start'};background:${message.role === 'user' ? '#0e639c' : '#252526'};${message.error ? 'border:1px solid #f14c4c;' : ''}`;
		bubble.dataset['messageId'] = message.id;

		const header = $<HTMLElement>('div', 'dc-chat-message-header');
		header.style.cssText = 'display:flex;align-items:center;gap:6px;';

		const avatar = $<HTMLElement>('span');
		avatar.textContent = message.role === 'assistant' ? '\u2728' : message.role === 'system' ? '\u2699' : '\uD83D\uDC64';
		avatar.style.cssText = 'font-size:12px;';

		const role = $<HTMLElement>('span');
		role.textContent = ROLE_LABELS[message.role];
		role.style.cssText = `font-size:11px;font-weight:600;letter-spacing:0.5px;color:${message.role === 'user' ? '#d6ecff' : '#8a8a8a'};`;

		const time = $<HTMLElement>('span');
		time.textContent = this._formatTime(message.timestamp);
		time.style.cssText = 'font-size:10px;color:#6a6a6a;margin-left:auto;';

		header.appendChild(avatar);
		header.appendChild(role);
		header.appendChild(time);

		const body = $<HTMLElement>('div', 'dc-chat-message-body');
		body.style.cssText = 'font-size:13px;line-height:1.5;color:#cccccc;white-space:pre-wrap;word-break:break-word;';

		bubble.appendChild(header);
		bubble.appendChild(body);
		container.appendChild(bubble);

		if (streaming) {
			this._streamInto(body, message.text);
		} else {
			body.innerHTML = ChatMessageRenderer.renderMarkdown(message.text);
		}

		this._register(addDisposableListener(bubble, 'dblclick', () => {
			this._onDidFinishStream.fire(message.text);
		}));
		return bubble;
	}

	private _streamInto(body: HTMLElement, fullText: string): void {
		if (this._streamTimer) {
			clearInterval(this._streamTimer);
		}
		let index = 0;
		const step = 12;
		body.textContent = '';
		this._streamTimer = setInterval(() => {
			index = Math.min(fullText.length, index + step);
			body.textContent = fullText.substring(0, index);
			if (index >= fullText.length) {
				clearInterval(this._streamTimer);
				this._streamTimer = undefined;
				body.innerHTML = ChatMessageRenderer.renderMarkdown(fullText);
				this._onDidFinishStream.fire(fullText);
			}
		}, 24);
	}

	public stopStreaming(): void {
		if (this._streamTimer) {
			clearInterval(this._streamTimer);
			this._streamTimer = undefined;
		}
	}

	private _formatTime(timestamp: number): string {
		const date = new Date(timestamp);
		const hh = String(date.getHours()).padStart(2, '0');
		const mm = String(date.getMinutes()).padStart(2, '0');
		return `${hh}:${mm}`;
	}

	public static renderMarkdown(text: string): string {
		const lines = text.split(/\r?\n/);
		const html: string[] = [];
		let inCode = false;
		let codeBuffer: string[] = [];
		let codeLang = '';

		const flushCode = (): void => {
			if (inCode) {
				html.push(`<pre style="background:#1e1e1e;border:1px solid #3c3c3c;border-radius:4px;padding:8px;overflow-x:auto;margin:4px 0;"><code data-lang="${escape(codeLang)}">${escape(codeBuffer.join('\n'))}</code></pre>`);
				codeBuffer = [];
				codeLang = '';
				inCode = false;
			}
		};

		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.startsWith('```')) {
				if (inCode) {
					flushCode();
				} else {
					inCode = true;
					codeLang = trimmed.substring(3).trim();
				}
				continue;
			}
			if (inCode) {
				codeBuffer.push(line);
				continue;
			}
			if (!trimmed) {
				html.push('<div style="height:6px;"></div>');
				continue;
			}
			let content = escape(trimmed);
			content = content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
			content = content.replace(/`([^`]+)`/g, '<code style="background:#3c3c3c;border-radius:3px;padding:0 4px;font-size:12px;">$1</code>');
			content = content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#3794ff;text-decoration:none;">$1</a>');
			html.push(`<div>${content}</div>`);
		}
		flushCode();
		return html.join('');
	}

	public static clearContainer(container: HTMLElement): void {
		clearNode(container);
	}
}

/**
 * Dardcor Code - Embedded Code Block Card with Apply to Editor Button
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, addDisposableListener } from '../../core/dom/element.js';
import { escape } from '../../core/types/strings.js';

export interface IChatCodeBlock {
	readonly id: string;
	readonly language: string;
	readonly code: string;
}

export interface IChatCodeBlockAction {
	readonly block: IChatCodeBlock;
	readonly action: 'apply' | 'copy' | 'insert';
}

export class ChatCodeBlock extends Disposable {
	private readonly _onDidApply = this._register(new Emitter<IChatCodeBlock>());
	readonly onDidApply: Event<IChatCodeBlock> = this._onDidApply.event;

	private readonly _onDidCopy = this._register(new Emitter<IChatCodeBlock>());
	readonly onDidCopy: Event<IChatCodeBlock> = this._onDidCopy.event;

	private readonly _onDidInsert = this._register(new Emitter<IChatCodeBlock>());
	readonly onDidInsert: Event<IChatCodeBlock> = this._onDidInsert.event;

	private _blockCounter = 1;

	public render(container: HTMLElement, block: IChatCodeBlock): HTMLElement {
		const card = $<HTMLElement>('div', 'dc-chat-code-block');
		card.style.cssText = 'border:1px solid #3c3c3c;border-radius:6px;overflow:hidden;margin:6px 0;background:#1e1e1e;';

		const header = $<HTMLElement>('div', 'dc-chat-code-header');
		header.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 10px;background:#252526;border-bottom:1px solid #3c3c3c;';

		const lang = $<HTMLElement>('span');
		lang.textContent = block.language || 'text';
		lang.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:0.5px;color:#8a8a8a;text-transform:uppercase;flex:1;';

		const actions = $<HTMLElement>('div');
		actions.style.cssText = 'display:flex;gap:4px;';

		const applyButton = $<HTMLButtonElement>('button');
		applyButton.textContent = 'Apply to Editor';
		applyButton.title = 'Terapkan kode ke editor aktif';
		applyButton.style.cssText = 'background:#0e639c;border:none;color:white;border-radius:2px;font-size:11px;padding:2px 8px;cursor:pointer;';

		const insertButton = $<HTMLButtonElement>('button');
		insertButton.textContent = 'Sisipkan';
		insertButton.title = 'Sisipkan kode pada posisi kursor';
		insertButton.style.cssText = 'background:#3c3c3c;border:none;color:#cccccc;border-radius:2px;font-size:11px;padding:2px 8px;cursor:pointer;';

		const copyButton = $<HTMLButtonElement>('button');
		copyButton.textContent = '\u2398';
		copyButton.title = 'Salin kode';
		copyButton.style.cssText = 'background:#3c3c3c;border:none;color:#cccccc;border-radius:2px;font-size:11px;padding:2px 8px;cursor:pointer;';

		actions.appendChild(applyButton);
		actions.appendChild(insertButton);
		actions.appendChild(copyButton);
		header.appendChild(lang);
		header.appendChild(actions);

		const body = $<HTMLElement>('pre', 'dc-chat-code-body');
		body.style.cssText = 'margin:0;padding:8px 10px;overflow-x:auto;font-family:Consolas,monospace;font-size:12px;line-height:1.5;color:#d4d4d4;white-space:pre;';
		body.innerHTML = escape(block.code);

		this._register(addDisposableListener(applyButton, 'click', () => this._onDidApply.fire(block)));
		this._register(addDisposableListener(insertButton, 'click', () => this._onDidInsert.fire(block)));
		this._register(addDisposableListener(copyButton, 'click', () => {
			void this._copyToClipboard(block.code);
			this._onDidCopy.fire(block);
		}));

		card.appendChild(header);
		card.appendChild(body);
		container.appendChild(card);
		return card;
	}

	public static extractCodeBlocks(markdown: string): IChatCodeBlock[] {
		const blocks: IChatCodeBlock[] = [];
		const regex = /```([a-zA-Z0-9_+-]*)\r?\n([\s\S]*?)```/g;
		let index = 1;
		let match: RegExpExecArray | null;
		while ((match = regex.exec(markdown)) !== null) {
			blocks.push({
				id: `chat-block-${index++}`,
				language: match[1] || 'text',
				code: match[2].replace(/\r?\n$/, '')
			});
		}
		return blocks;
	}

	public static toBlocks(markdown: string): IChatCodeBlock[] {
		return ChatCodeBlock.extractCodeBlocks(markdown);
	}

	private async _copyToClipboard(text: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			const textarea = document.createElement('textarea');
			textarea.value = text;
			textarea.style.position = 'fixed';
			textarea.style.opacity = '0';
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand('copy');
			textarea.remove();
		}
	}
}

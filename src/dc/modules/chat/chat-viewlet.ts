/**
 * Dardcor Code - AI Assistant Chat Panel Viewlet Component
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { CssInjector } from '../../core/dom/css-injector';
import { ChatMessageRenderer, IChatMessage, ChatMessageRole, createChatMessage } from './chat-message-renderer';

const CHAT_STYLE_ID = 'dc-chat-viewlet-styles';

export interface IChatResponder {
	respond(prompt: string, history: IChatMessage[]): Promise<string>;
}

export class MockChatResponder implements IChatResponder {
	public async respond(prompt: string): Promise<string> {
		await new Promise(resolve => setTimeout(resolve, 350 + Math.random() * 400));
		const lower = prompt.toLowerCase();
		if (lower.startsWith('/explain')) {
			return '**Penjelasan kode**\n\n1. Baca struktur file yang dipilih.\n2. Identifikasi fungsi utama dan alur eksekusinya.\n3. Ringkas tiap bagian penting dalam bahasa yang mudah dipahami.\n\nSilakan pilih file di explorer untuk saya jelaskan.';
		}
		if (lower.startsWith('/fix')) {
			return '**Saran perbaikan**\n\nSaya melihat potensi perbaikan berikut:\n- Cek `strictNullChecks` di tsconfig untuk menghindari `undefined`.\n- Tambahkan guard untuk kondisi kosong.\n- Gunakan `const` untuk nilai yang tidak berubah.';
		}
		if (lower.startsWith('/tests')) {
			return '**Rencana pengujian**\n\nSaya dapat membantu menuliskan unit test untuk modul ini:\n1. Uji kasus normal.\n2. Uji kasus kosong / error.\n3. Uji edge case batas atas.';
		}
		if (lower.includes('hai') || lower.includes('halo') || lower.includes('hello')) {
			return `Halo! Saya asisten AI Dardcor Code. Anda bisa bertanya tentang kode, meminta penjelasan (\`/explain\`), perbaikan (\`/fix\`), atau rencana test (\`/tests\`).`;
		}
		return `Saya menerima pesan Anda: "${prompt}"\n\nIni adalah respons placeholder dari asisten offline. Di versi lengkap, bagian ini akan terhubung ke LLM lokal atau remote.`;
	}
}

export class ChatViewlet extends Disposable {
	private readonly _onDidSendMessage = this._register(new Emitter<IChatMessage>());
	readonly onDidSendMessage: Event<IChatMessage> = this._onDidSendMessage.event;

	private readonly _onDidRespond = this._register(new Emitter<IChatMessage>());
	readonly onDidRespond: Event<IChatMessage> = this._onDidRespond.event;

	private readonly _container: HTMLElement;
	private readonly _messagesContainer: HTMLElement;
	private readonly _input: HTMLTextAreaElement;
	private readonly _sendButton: HTMLButtonElement;
	private readonly _clearButton: HTMLButtonElement;
	private readonly _renderer: ChatMessageRenderer;
	private readonly _responder: IChatResponder;
	private _messages: IChatMessage[] = [];
	private _busy = false;

	constructor(parentDom: HTMLElement, responder?: IChatResponder) {
		super();
		this._responder = responder ?? new MockChatResponder();
		this._renderer = new ChatMessageRenderer();

		CssInjector.inject(CHAT_STYLE_ID, `
			.dc-chat-messages { display: flex; flex-direction: column; gap: 8px; padding: 12px; }
			.dc-chat-input { background: #3c3c3c; border: 1px solid #3c3c3c; border-radius: 4px; color: #cccccc; font-size: 13px; padding: 8px; resize: none; outline: none; font-family: inherit; }
			.dc-chat-input:focus { border-color: #007fd4; }
		`);

		this._container = $<HTMLElement>('div', 'dc-chat-viewlet');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:#1e1e1e;';

		const toolbar = $<HTMLElement>('div');
		toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid #2a2d2e;';
		const title = $<HTMLElement>('span');
		title.textContent = 'Chat';
		title.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:1px;color:#bbbbbb;text-transform:uppercase;flex:1;';
		this._clearButton = $<HTMLButtonElement>('button');
		this._clearButton.textContent = '\u2716';
		this._clearButton.title = 'Bersihkan percakapan';
		this._clearButton.style.cssText = 'background:transparent;border:none;color:#8a8a8a;cursor:pointer;font-size:12px;';
		toolbar.appendChild(title);
		toolbar.appendChild(this._clearButton);
		this._container.appendChild(toolbar);

		this._messagesContainer = $<HTMLElement>('div', 'dc-chat-messages');
		this._messagesContainer.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;';
		this._container.appendChild(this._messagesContainer);

		const inputRow = $<HTMLElement>('div');
		inputRow.style.cssText = 'display:flex;gap:6px;padding:8px;border-top:1px solid #2a2d2e;';
		this._input = $<HTMLTextAreaElement>('textarea', 'dc-chat-input');
		this._input.rows = 2;
		this._input.placeholder = 'Tanya asisten, mis. "/explain file.ts"';
		this._input.style.flex = '1';
		this._sendButton = $<HTMLButtonElement>('button');
		this._sendButton.textContent = '\u25B6';
		this._sendButton.title = 'Kirim (Ctrl+Enter)';
		this._sendButton.style.cssText = 'background:#0e639c;border:none;color:white;border-radius:4px;padding:0 14px;font-size:14px;cursor:pointer;';
		inputRow.appendChild(this._input);
		inputRow.appendChild(this._sendButton);
		this._container.appendChild(inputRow);
		parentDom.appendChild(this._container);

		this._register(addDisposableListener(this._sendButton, 'click', () => {
			void this.send();
		}));
		this._register(addDisposableListener(this._input, 'keydown', (e) => {
			const kd = e as KeyboardEvent;
			if (kd.key === 'Enter' && (kd.ctrlKey || kd.metaKey)) {
				e.preventDefault();
				void this.send();
			}
		}));
		this._register(addDisposableListener(this._clearButton, 'click', () => {
			this.clear();
		}));

		this._showWelcome();
	}

	get messages(): IChatMessage[] {
		return [...this._messages];
	}

	get isBusy(): boolean {
		return this._busy;
	}

	public focus(): void {
		this._input.focus();
	}

	public async send(text?: string): Promise<void> {
		const prompt = (text ?? this._input.value).trim();
		if (!prompt || this._busy) {
			return;
		}
		this._input.value = '';
		this._busy = true;
		this._sendButton.disabled = true;

		const userMessage = createChatMessage('user', prompt);
		this._messages.push(userMessage);
		this._renderMessage(userMessage);
		this._onDidSendMessage.fire(userMessage);

		const assistantMessage = createChatMessage('assistant', '\u2026');
		this._messages.push(assistantMessage);
		const bubble = this._renderMessage(assistantMessage, true);
		void bubble;

		try {
			const response = await this._responder.respond(prompt, this.messages);
			(assistantMessage as { text: string }).text = response;
			this._onDidRespond.fire(assistantMessage);
		} catch (err) {
			(assistantMessage as { text: string; error: boolean }).text = `Gagal menghasilkan respons: ${String(err)}`;
			(assistantMessage as { error: boolean }).error = true;
		} finally {
			this._busy = false;
			this._sendButton.disabled = false;
			this._renderAll();
			this._scrollToBottom();
		}
	}

	public loadHistory(messages: IChatMessage[]): void {
		this._messages = messages.filter(m => m && typeof m.text === 'string');
		this._renderAll();
	}

	public clear(): void {
		this._messages = [];
		this._renderer.stopStreaming();
		this._renderAll();
		this._showWelcome();
	}

	private _showWelcome(): void {
		const welcome = createChatMessage('assistant', 'Halo! Saya asisten AI bawaan **Dardcor Code**.\n\nKetik pesan di bawah, atau gunakan perintah slash:\n- `/explain` \u2014 jelaskan kode\n- `/fix` \u2014 saran perbaikan\n- `/tests` \u2014 rencana pengujian');
		this._messages = [welcome];
		this._renderAll();
	}

	private _renderMessage(message: IChatMessage, streaming = false): HTMLElement {
		return this._renderer.render(this._messagesContainer, message, streaming);
	}

	private _renderAll(): void {
		clearNode(this._messagesContainer);
		for (const message of this._messages) {
			this._renderMessage(message, false);
		}
	}

	private _scrollToBottom(): void {
		this._messagesContainer.scrollTop = this._messagesContainer.scrollHeight;
	}
}

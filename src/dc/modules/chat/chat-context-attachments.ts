/**
 * Dardcor Code - @file and @workspace Context Reference Attachment Selector
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, clearNode, addDisposableListener } from '../../core/dom/element.js';
import { Path } from '../../core/types/path.js';

export type ChatAttachmentKind = 'file' | 'workspace' | 'selection';

export interface IChatAttachment {
	readonly id: string;
	readonly kind: ChatAttachmentKind;
	readonly label: string;
	readonly path?: string;
}

export interface IChatAttachmentChangeEvent {
	readonly attachments: readonly IChatAttachment[];
	readonly added: IChatAttachment | undefined;
	readonly removed: IChatAttachment | undefined;
}

export class ChatContextAttachments extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<IChatAttachmentChangeEvent>());
	readonly onDidChange: Event<IChatAttachmentChangeEvent> = this._onDidChange.event;

	private readonly _attachments: IChatAttachment[] = [];
	private _idCounter = 1;

	public get attachments(): IChatAttachment[] {
		return [...this._attachments];
	}

	public get count(): number {
		return this._attachments.length;
	}

	public addFile(path: string): IChatAttachment {
		const existing = this._attachments.find(a => a.path === path);
		if (existing) {
			return existing;
		}
		const attachment: IChatAttachment = {
			id: `att-${this._idCounter++}`,
			kind: 'file',
			label: Path.basename(path),
			path
		};
		this._attachments.push(attachment);
		this._onDidChange.fire({ attachments: this.attachments, added: attachment, removed: undefined });
		return attachment;
	}

	public addWorkspace(): IChatAttachment {
		const existing = this._attachments.find(a => a.kind === 'workspace');
		if (existing) {
			return existing;
		}
		const attachment: IChatAttachment = {
			id: `att-${this._idCounter++}`,
			kind: 'workspace',
			label: 'Workspace'
		};
		this._attachments.push(attachment);
		this._onDidChange.fire({ attachments: this.attachments, added: attachment, removed: undefined });
		return attachment;
	}

	public addSelection(label: string): IChatAttachment {
		const attachment: IChatAttachment = {
			id: `att-${this._idCounter++}`,
			kind: 'selection',
			label
		};
		this._attachments.push(attachment);
		this._onDidChange.fire({ attachments: this.attachments, added: attachment, removed: undefined });
		return attachment;
	}

	public remove(id: string): void {
		const index = this._attachments.findIndex(a => a.id === id);
		if (index === -1) {
			return;
		}
		const removed = this._attachments[index];
		this._attachments.splice(index, 1);
		this._onDidChange.fire({ attachments: this.attachments, added: undefined, removed });
	}

	public clear(): void {
		if (this._attachments.length === 0) {
			return;
		}
		this._attachments.splice(0, this._attachments.length);
		this._onDidChange.fire({ attachments: [], added: undefined, removed: undefined });
	}

	public parseMentions(input: string, resolvePath?: (mention: string) => string | undefined): IChatAttachment[] {
		const mentions = ChatContextAttachments.extractMentions(input);
		for (const mention of mentions) {
			const normalized = mention.toLowerCase();
			if (normalized === 'workspace') {
				this.addWorkspace();
			} else {
				const path = resolvePath?.(mention) ?? mention;
				this.addFile(path);
			}
		}
		return this.attachments;
	}

	public render(container: HTMLElement): void {
		clearNode(container);
		for (const attachment of this._attachments) {
			const chip = $<HTMLElement>('span', 'dc-chat-attachment-chip');
			chip.style.cssText = `display:inline-flex;align-items:center;gap:4px;background:${attachment.kind === 'workspace' ? '#0e639c' : '#3c3c3c'};color:#ffffff;border-radius:10px;font-size:11px;padding:1px 4px 1px 8px;cursor:default;user-select:none;max-width:180px;`;
			chip.title = attachment.path ?? attachment.label;

			const icon = $<HTMLElement>('span');
			icon.textContent = attachment.kind === 'workspace' ? '\u2637' : attachment.kind === 'selection' ? '\u2756' : '\uD83D\uDCC4';
			icon.style.fontSize = '10px';

			const label = $<HTMLElement>('span');
			label.textContent = attachment.label;
			label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

			const remove = $<HTMLButtonElement>('button');
			remove.textContent = '\u2716';
			remove.title = 'Hapus lampiran';
			remove.style.cssText = 'background:transparent;border:none;color:#cccccc;cursor:pointer;font-size:9px;padding:0 2px;';
			this._register(addDisposableListener(remove, 'click', () => this.remove(attachment.id)));

			chip.appendChild(icon);
			chip.appendChild(label);
			chip.appendChild(remove);
			container.appendChild(chip);
		}
	}

	public static extractMentions(input: string): string[] {
		const mentions: string[] = [];
		const regex = /@([\w\-./\\]+)/g;
		let match: RegExpExecArray | null;
		while ((match = regex.exec(input)) !== null) {
			mentions.push(match[1]);
		}
		return mentions;
	}
}

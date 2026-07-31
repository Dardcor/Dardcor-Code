/**
 * Dardcor Code - Raw keybindings.json Code Editor Adapter
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, addDisposableListener } from '../../core/dom/element';
import { JSONParser } from '../../core/formatting/json-parser';
import { KeybindingRegistry } from './keybindings-editor';

export interface IKeybindingsJsonValidation {
	readonly valid: boolean;
	readonly message?: string;
	readonly unknownCommands: string[];
	readonly entryCount: number;
}
export type IKeybindingJsonValidation = IKeybindingsJsonValidation;


export interface IKeybindingJsonEntry {
	readonly key: string;
	readonly command: string;
	readonly when?: string;
}

export class JsonKeybindingsEditor extends Disposable {
	private readonly _onDidSave = this._register(new Emitter<void>());
	readonly onDidSave: Event<void> = this._onDidSave.event;

	private readonly _container: HTMLElement;
	private readonly _textarea: HTMLTextAreaElement;
	private readonly _statusLabel: HTMLElement;
	private readonly _saveButton: HTMLButtonElement;
	private readonly _formatButton: HTMLButtonElement;
	private readonly _registry: KeybindingRegistry;

	constructor(parentDom: HTMLElement, registry?: KeybindingRegistry) {
		super();
		this._registry = registry ?? new KeybindingRegistry();

		this._container = $<HTMLElement>('div', 'dc-json-keybindings-editor');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:#1e1e1e;';

		const toolbar = $<HTMLElement>('div');
		toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #2a2d2e;';

		this._saveButton = $<HTMLButtonElement>('button');
		this._saveButton.textContent = 'Simpan';
		this._saveButton.style.cssText = 'background:#0e639c;border:none;color:white;border-radius:2px;padding:4px 14px;font-size:12px;cursor:pointer;';

		this._formatButton = $<HTMLButtonElement>('button');
		this._formatButton.textContent = 'Format';
		this._formatButton.style.cssText = 'background:#3c3c3c;border:none;color:#cccccc;border-radius:2px;padding:4px 14px;font-size:12px;cursor:pointer;';

		this._statusLabel = $<HTMLElement>('span');
		this._statusLabel.style.cssText = 'font-size:11px;color:#8a8a8a;flex:1;text-align:right;';

		toolbar.appendChild(this._saveButton);
		toolbar.appendChild(this._formatButton);
		toolbar.appendChild(this._statusLabel);
		this._container.appendChild(toolbar);

		this._textarea = $<HTMLTextAreaElement>('textarea');
		this._textarea.style.cssText = 'flex:1;width:100%;box-sizing:border-box;background:#1e1e1e;border:none;color:#cccccc;font-size:13px;padding:12px;font-family:Consolas,monospace;line-height:1.5;outline:none;resize:none;white-space:pre;';
		this._textarea.spellcheck = false;
		this._container.appendChild(this._textarea);
		parentDom.appendChild(this._container);

		this._syncFromRegistry();

		this._register(addDisposableListener(this._saveButton, 'click', () => void this.save()));
		this._register(addDisposableListener(this._formatButton, 'click', () => this.format()));
		this._register(addDisposableListener(this._textarea, 'input', () => {
			this._validate(this._textarea.value);
		}));
	}

	get value(): string {
		return this._textarea.value;
	}

	set value(text: string) {
		this._textarea.value = text;
		this._validate(text);
	}

	public focus(): void {
		this._textarea.focus();
	}

	private _syncFromRegistry(): void {
		const entries: IKeybindingJsonEntry[] = [];
		for (const entry of this._registry.getEntries()) {
			if (entry.source === 'user' && entry.keybinding) {
				entries.push({ key: entry.keybinding, command: entry.commandId, when: entry.when });
			}
		}
		this._textarea.value = JSON.stringify(entries, null, 4);
		this._validate(this._textarea.value);
	}

	public static parseEntries(text: string): IKeybindingJsonEntry[] {
		try {
			const parsed = JSONParser.parse(text);
			if (!Array.isArray(parsed)) {
				return [];
			}
			return parsed.filter((entry: any): entry is IKeybindingJsonEntry => {
				return entry && typeof entry === 'object' && typeof entry.key === 'string' && typeof entry.command === 'string';
			});
		} catch {
			return [];
		}
	}

	public static validate(text: string): IKeybindingsJsonValidation {
		const unknownCommands: string[] = [];
		try {
			const parsed = JSONParser.parse(text);
			if (!Array.isArray(parsed)) {
				return { valid: false, message: 'Root harus berupa array', unknownCommands, entryCount: 0 };
			}
			const entries = parsed.filter((entry: any) => entry && typeof entry === 'object');
			for (const entry of entries) {
				if (typeof entry.key !== 'string' || typeof entry.command !== 'string') {
					return { valid: false, message: 'Setiap entri harus memiliki "key" dan "command" string', unknownCommands, entryCount: entries.length };
				}
				if (entry.command.startsWith('-')) {
					continue;
				}
				if (!entry.command.includes('.')) {
					unknownCommands.push(entry.command);
				}
			}
			return { valid: true, unknownCommands, entryCount: entries.length };
		} catch (err) {
			return {
				valid: false,
				message: err instanceof Error ? err.message : String(err),
				unknownCommands,
				entryCount: 0
			};
		}
	}

	private _validate(text: string): IKeybindingsJsonValidation {
		const result = JsonKeybindingsEditor.validate(text);
		if (result.valid) {
			const unknownNote = result.unknownCommands.length > 0 ? ` (perintah tidak dikenal: ${result.unknownCommands.join(', ')})` : '';
			this._statusLabel.textContent = `${result.entryCount} keybinding \u00B7 Valid JSON${unknownNote}`;
			this._statusLabel.style.color = result.unknownCommands.length > 0 ? '#e5e510' : '#23d18b';
		} else {
			this._statusLabel.textContent = `Error: ${result.message ?? 'tidak valid'}`;
			this._statusLabel.style.color = '#f14c4c';
		}
		return result;
	}

	public format(): void {
		try {
			const parsed = JSONParser.parse(this._textarea.value);
			this._textarea.value = JSON.stringify(parsed, null, 4);
			this._validate(this._textarea.value);
		} catch (err) {
			this._statusLabel.textContent = `Tidak bisa format: ${String(err)}`;
			this._statusLabel.style.color = '#f14c4c';
		}
	}

	public async save(): Promise<boolean> {
		const result = this._validate(this._textarea.value);
		if (!result.valid) {
			this._statusLabel.textContent = `Gagal simpan: ${result.message ?? 'JSON tidak valid'}`;
			this._statusLabel.style.color = '#f14c4c';
			return false;
		}
		const entries = JsonKeybindingsEditor.parseEntries(this._textarea.value);
		for (const entry of entries) {
			const commandId = entry.command.startsWith('-') ? entry.command.substring(1) : entry.command;
			this._registry.setBinding(commandId, entry.key);
		}
		this._statusLabel.textContent = `Tersimpan (${entries.length} keybinding)`;
		this._statusLabel.style.color = '#23d18b';
		this._onDidSave.fire();
		return true;
	}
}

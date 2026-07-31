/**
 * Dardcor Code - Raw settings.json Code Editor Adapter with JSON Schema Validation
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, addDisposableListener } from '../../core/dom/element';
import { IConfigurationService, ConfigurationService } from '../../services/configuration/configuration-service';
import { JSONParser } from '../../core/formatting/json-parser';

export interface IJsonValidationResult {
	readonly valid: boolean;
	readonly message?: string;
	readonly line?: number;
	readonly column?: number;
	readonly unknownKeys: string[];
}

const KNOWN_SETTING_KEYS = new Set([
	'editor.fontSize', 'editor.tabSize', 'editor.insertSpaces', 'editor.wordWrap',
	'editor.renderWhitespace', 'workbench.colorTheme', 'workbench.activityBar.location',
	'workbench.editor.showTabs', 'terminal.integrated.shell', 'terminal.integrated.fontSize',
	'terminal.integrated.cursorBlinking', 'terminal.integrated.scrollback',
	'search.exclude', 'search.useRipgrep', 'files.exclude', 'files.autoSave',
	'git.enabled', 'git.autofetch', 'debug.console.fontSize', 'debug.showBreakpointsInGutter'
]);

export class JsonSettingsEditor extends Disposable {
	private readonly _onDidSave = this._register(new Emitter<void>());
	readonly onDidSave: Event<void> = this._onDidSave.event;

	private readonly _container: HTMLElement;
	private readonly _textarea: HTMLTextAreaElement;
	private readonly _statusLabel: HTMLElement;
	private readonly _saveButton: HTMLButtonElement;
	private readonly _formatButton: HTMLButtonElement;
	private readonly _configurationService: IConfigurationService;
	private _currentConfig: Record<string, any> = {};

	constructor(parentDom: HTMLElement, configurationService?: IConfigurationService) {
		super();
		this._configurationService = configurationService ?? new ConfigurationService();
		this._currentConfig = this._configurationService.getValue<Record<string, any>>();

		this._container = $<HTMLElement>('div', 'dc-json-settings-editor');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:#1e1e1e;';

		const toolbar = $<HTMLElement>('div');
		toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #2a2d2e;';

		this._saveButton = $<HTMLButtonElement>('button');
		this._saveButton.textContent = 'Simpan';
		this._saveButton.style.cssText = 'background:#0e639c;border:none;color:white;border-radius:2px;padding:4px 14px;font-size:12px;cursor:pointer;';

		this._formatButton = $<HTMLButtonElement>('button');
		this._formatButton.textContent = 'Format';
		this._formatButton.style.cssText = 'background:#3c3c3c;border:none;color:#cccccc;border-radius:2px;padding:4px 14px;font-size:12px;cursor:pointer;';

		this._statusLabel = $<HTMLElement>('span', 'dc-json-settings-status');
		this._statusLabel.style.cssText = 'font-size:11px;color:#8a8a8a;flex:1;text-align:right;';

		toolbar.appendChild(this._saveButton);
		toolbar.appendChild(this._formatButton);
		toolbar.appendChild(this._statusLabel);
		this._container.appendChild(toolbar);

		this._textarea = $<HTMLTextAreaElement>('textarea', 'dc-json-settings-textarea');
		this._textarea.style.cssText = 'flex:1;width:100%;box-sizing:border-box;background:#1e1e1e;border:none;color:#cccccc;font-size:13px;padding:12px;font-family:Consolas,monospace;line-height:1.5;outline:none;resize:none;white-space:pre;';
		this._textarea.spellcheck = false;
		this._container.appendChild(this._textarea);
		parentDom.appendChild(this._container);

		this._syncFromConfig();

		this._register(addDisposableListener(this._saveButton, 'click', () => this.save()));
		this._register(addDisposableListener(this._formatButton, 'click', () => this.format()));
		this._register(addDisposableListener(this._textarea, 'input', () => {
			this._validate(this._textarea.value);
		}));
	}

	public get value(): string {
		return this._textarea.value;
	}

	public set value(text: string) {
		this._textarea.value = text;
		this._validate(text);
	}

	public focus(): void {
		this._textarea.focus();
	}

	private _serializeConfig(): string {
		const sorted: Record<string, any> = {};
		for (const key of Object.keys(this._currentConfig).sort()) {
			sorted[key] = this._currentConfig[key];
		}
		return JSON.stringify(sorted, null, 4);
	}

	private _syncFromConfig(): void {
		this._currentConfig = this._configurationService.getValue<Record<string, any>>() ?? {};
		this._textarea.value = this._serializeConfig();
		this._validate(this._textarea.value);
	}

	public static validate(text: string): IJsonValidationResult {
		const unknownKeys: string[] = [];
		try {
			const parsed = JSONParser.parse(text);
			if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
				return { valid: false, message: 'Root harus berupa objek JSON', unknownKeys };
			}
			for (const key of Object.keys(parsed as Record<string, any>)) {
				if (!KNOWN_SETTING_KEYS.has(key)) {
					unknownKeys.push(key);
				}
			}
			return { valid: true, unknownKeys };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const position = JsonSettingsEditor._extractErrorPosition(message);
			return {
				valid: false,
				message,
				line: position?.line,
				column: position?.column,
				unknownKeys
			};
		}
	}

	private static _extractErrorPosition(message: string): { line: number; column: number } | undefined {
		const match = /position\s+(\d+)/i.exec(message);
		if (!match) {
			return undefined;
		}
		const position = parseInt(match[1], 10);
		return { line: position, column: position };
	}

	private _validate(text: string): IJsonValidationResult {
		const result = JsonSettingsEditor.validate(text);
		if (result.valid) {
			const unknownNote = result.unknownKeys.length > 0 ? ` (kunci tidak dikenal: ${result.unknownKeys.join(', ')})` : '';
			this._statusLabel.textContent = 'Valid JSON' + unknownNote;
			this._statusLabel.style.color = result.unknownKeys.length > 0 ? '#e5e510' : '#23d18b';
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
		try {
			const parsed = JSONParser.parse<Record<string, any>>(this._textarea.value);
			for (const [key, value] of Object.entries(parsed)) {
				await this._configurationService.updateValue(key, value);
			}
			this._currentConfig = parsed;
			this._statusLabel.textContent = 'Tersimpan';
			this._statusLabel.style.color = '#23d18b';
			this._onDidSave.fire();
			return true;
		} catch (err) {
			this._statusLabel.textContent = `Gagal simpan: ${String(err)}`;
			this._statusLabel.style.color = '#f14c4c';
			return false;
		}
	}
}

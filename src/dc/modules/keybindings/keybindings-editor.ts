/**
 * Dardcor Code - Visual Keyboard Shortcuts Keybinding GUI Editor Pane
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { CssInjector } from '../../core/dom/css-injector';
import { CommandRegistry } from '../../services/commands/command-service';

export interface IKeybindingEntry {
	readonly commandId: string;
	readonly title: string;
	readonly keybinding: string;
	readonly source: 'default' | 'user';
	readonly when?: string;
}

export const DEFAULT_KEYBINDINGS: Record<string, string> = {
	// 1896
	'editor.action.clipboardCopyAction': 'Ctrl+C',
	'editor.action.clipboardPasteAction': 'Ctrl+V',
	'editor.action.clipboardCutAction': 'Ctrl+X',
	'undo': 'Ctrl+Z',
	'redo': 'Ctrl+Y',
	// 1897
	'actions.find': 'Ctrl+F',
	'editor.action.startFindReplaceAction': 'Ctrl+H',
	'editor.action.nextMatchFindAction': 'F3',
	'editor.action.previousMatchFindAction': 'Shift+F3',
	// 1898
	'workbench.action.findInFiles': 'Ctrl+Shift+F',
	'workbench.action.replaceInFiles': 'Ctrl+Shift+H',
	// 1899
	'workbench.action.quickOpen': 'Ctrl+P',
	'workbench.action.showCommands': 'Ctrl+Shift+P',
	// 1900
	'workbench.action.files.newUntitledFile': 'Ctrl+N',
	'workbench.action.files.openFile': 'Ctrl+O',
	'workbench.action.files.save': 'Ctrl+S',
	'workbench.action.files.saveAs': 'Ctrl+Shift+S',
	'workbench.action.files.saveAll': 'Ctrl+K S',
	// 1901
	'workbench.action.closeActiveEditor': 'Ctrl+W',
	'workbench.action.closeWindow': 'Ctrl+Shift+W',
	// 1902
	'workbench.action.toggleSidebarVisibility': 'Ctrl+B',
	'workbench.action.terminal.toggleTerminal': 'Ctrl+`',
	'workbench.action.terminal.new': 'Ctrl+Shift+`',
	// 1903
	'workbench.view.explorer': 'Ctrl+Shift+E',
	'workbench.view.scm': 'Ctrl+Shift+G',
	'workbench.view.debug': 'Ctrl+Shift+D',
	'workbench.view.extensions': 'Ctrl+Shift+X',
	// 1904
	'workbench.actions.view.problems': 'Ctrl+Shift+M',
	'workbench.action.output.toggleOutput': 'Ctrl+Shift+U',
	'workbench.debug.action.toggleRepl': 'Ctrl+Shift+Y',
	// 1905
	'workbench.action.debug.start': 'F5',
	'workbench.action.debug.run': 'Ctrl+F5',
	'workbench.action.debug.stop': 'Shift+F5',
	'editor.debug.action.toggleBreakpoint': 'F9',
	'workbench.action.debug.stepOver': 'F10',
	'workbench.action.debug.stepInto': 'F11',
	'workbench.action.debug.stepOut': 'Shift+F11',
	// 1906
	'editor.action.revealDefinition': 'F12',
	'editor.action.peekDefinition': 'Alt+F12',
	'editor.action.referenceSearch.trigger': 'Shift+F12',
	'editor.action.goToImplementation': 'Ctrl+F12',
	'editor.action.goToTypeDefinition': 'Ctrl+Shift+F12',
	// 1907
	'editor.action.triggerSuggest': 'Ctrl+Space',
	'editor.action.triggerParameterHints': 'Ctrl+Shift+Space',
	// 1908
	'editor.action.rename': 'F2',
	'editor.action.formatDocument': 'Shift+Alt+F',
	'editor.action.formatSelection': 'Ctrl+K Ctrl+F',
	// 1909
	'editor.action.commentLine': 'Ctrl+/',
	'editor.action.blockComment': 'Shift+Alt+A',
	// 1910
	'editor.action.addSelectionToNextFindMatch': 'Ctrl+D',
	'editor.action.selectHighlights': 'Ctrl+Shift+L',
	'editor.action.copyLinesDownAction': 'Shift+Alt+Down',
	'editor.action.copyLinesUpAction': 'Shift+Alt+Up',
	'editor.action.moveLinesDownAction': 'Alt+Down',
	'editor.action.moveLinesUpAction': 'Alt+Up',
	// 1911
	'workbench.action.gotoSymbol': 'Ctrl+Shift+O',
	'workbench.action.showAllSymbols': 'Ctrl+T',
	'workbench.action.gotoLine': 'Ctrl+G',
	// 1912
	'workbench.action.quickOpenPreviousRecentlyUsedEditorInGroup': 'Ctrl+Tab',
	'workbench.action.nextEditor': 'Ctrl+PageDown',
	'workbench.action.previousEditor': 'Ctrl+PageUp',
	// 1913
	'workbench.action.toggleZenMode': 'Ctrl+K Z',
	'workbench.action.editorLayoutSingle': 'Ctrl+Shift+1',
	'workbench.action.editorLayoutTwoColumns': 'Ctrl+Shift+2',
	'workbench.action.editorLayoutThreeColumns': 'Ctrl+Shift+3',
	// 1914
	'workbench.action.zoomIn': 'Ctrl+=',
	'workbench.action.zoomOut': 'Ctrl+-',
	'workbench.action.zoomReset': 'Ctrl+0',
	'workbench.action.toggleFullScreen': 'F11',
	// 1915
	'workbench.action.tasks.build': 'Ctrl+Shift+B',
	'workbench.action.tasks.test': 'Ctrl+Shift+X',
	// 1916
	'workbench.action.openGlobalKeybindings': 'Ctrl+K Ctrl+S',
	'workbench.action.keybindingsReference': 'Ctrl+K Ctrl+R',
	// 1917
	'editor.action.insertCursorBelow': 'Ctrl+Alt+Down',
	'editor.action.insertCursorAbove': 'Ctrl+Alt+Up',
	'editor.action.smartSelect.expand': 'Shift+Alt+Right',
	'editor.action.smartSelect.shrink': 'Shift+Alt+Left',
	// 1918
	'editor.action.addCommentLine': 'Ctrl+K Ctrl+C',
	'editor.action.removeCommentLine': 'Ctrl+K Ctrl+U',
	// 1919
	'markdown.showPreview': 'Ctrl+Shift+V',
	'markdown.showPreviewToSide': 'Ctrl+K V'
};

const KEYBINDINGS_STYLE_ID = 'dc-keybindings-editor-styles';

export class KeybindingRegistry extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _userBindings = new Map<string, string>();

	public getBinding(commandId: string): string {
		return this._userBindings.get(commandId) ?? DEFAULT_KEYBINDINGS[commandId] ?? '';
	}

	public getSource(commandId: string): 'default' | 'user' {
		return this._userBindings.has(commandId) ? 'user' : 'default';
	}

	public setBinding(commandId: string, keybinding: string): void {
		if (keybinding) {
			this._userBindings.set(commandId, keybinding);
		} else {
			this._userBindings.delete(commandId);
		}
		this._onDidChange.fire();
	}

	public resetBinding(commandId: string): void {
		this._userBindings.delete(commandId);
		this._onDidChange.fire();
	}

	public getEntries(): IKeybindingEntry[] {
		const entries: IKeybindingEntry[] = [];
		const commandIds = new Set<string>([...CommandRegistry.getCommands().keys(), ...Object.keys(DEFAULT_KEYBINDINGS), ...this._userBindings.keys()]);
		for (const commandId of commandIds) {
			entries.push({
				commandId,
				title: KeybindingRegistry.prettifyCommandId(commandId),
				keybinding: this.getBinding(commandId),
				source: this.getSource(commandId)
			});
		}
		return entries.sort((a, b) => a.title.localeCompare(b.title));
	}

	public static prettifyCommandId(commandId: string): string {
		const parts = commandId.split('.').filter(p => p !== 'action' && p !== 'workbench');
		return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
	}
}

const SPECIAL_KEY_NAMES: Record<string, string> = {
	' ': 'Space',
	Escape: 'Esc',
	ArrowUp: 'Up',
	ArrowDown: 'Down',
	ArrowLeft: 'Left',
	ArrowRight: 'Right',
	'`': '`',
	'-': '-',
	'=': '=',
	';': ';',
	"'": "'",
	',': ',',
	'.': '.',
	'/': '/',
	'\\': '\\',
	'[': '[',
	']': ']'
};

export function eventToKeybindingLabel(e: KeyboardEvent): string {
	if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') {
		return '';
	}
	const parts: string[] = [];
	if (e.ctrlKey) parts.push('Ctrl');
	if (e.altKey) parts.push('Alt');
	if (e.shiftKey) parts.push('Shift');
	if (e.metaKey) parts.push('Win');
	let key: string;
	if (e.key.length === 1) {
		key = e.key.toUpperCase();
	} else {
		key = SPECIAL_KEY_NAMES[e.key] ?? e.key;
	}
	parts.push(key);
	return parts.join('+');
}

export class KeybindingsEditor extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _searchInput: HTMLInputElement;
	private readonly _table: HTMLElement;
	private readonly _registry: KeybindingRegistry;
	private _recordingCommandId: string | undefined;

	constructor(parentDom: HTMLElement, registry?: KeybindingRegistry) {
		super();
		this._registry = registry ?? new KeybindingRegistry();

		CssInjector.inject(KEYBINDINGS_STYLE_ID, `
			.dc-keybindings-table { width: 100%; border-collapse: collapse; font-size: 13px; }
			.dc-keybindings-table th { text-align: left; color: #bbbbbb; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; padding: 8px 12px; border-bottom: 1px solid #2a2d2e; user-select: none; }
			.dc-keybindings-table td { padding: 4px 12px; color: #cccccc; border-bottom: 1px solid #252526; }
			.dc-keybindings-table tr:hover td { background: #2a2d2e; }
			.dc-keybinding-chord { background: #3c3c3c; border: 1px solid #3c3c3c; border-radius: 2px; padding: 2px 8px; font-family: Consolas, monospace; font-size: 12px; }
			.dc-keybinding-record { background: #f2f2f2; color: #000000; border-radius: 2px; padding: 2px 8px; font-family: Consolas, monospace; font-size: 12px; }
		`);

		this._container = $<HTMLElement>('div', 'dc-keybindings-editor');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:#1e1e1e;';

		const toolbar = $<HTMLElement>('div');
		toolbar.style.cssText = 'padding:12px 16px;border-bottom:1px solid #2a2d2e;display:flex;gap:8px;align-items:center;';
		this._searchInput = $<HTMLInputElement>('input');
		this._searchInput.placeholder = 'Cari keybinding';
		this._searchInput.style.cssText = 'flex:1;background:#3c3c3c;border:none;border-radius:2px;color:#cccccc;font-size:13px;padding:5px 10px;outline:none;';
		toolbar.appendChild(this._searchInput);
		this._container.appendChild(toolbar);

		const scrollContainer = $<HTMLElement>('div');
		scrollContainer.style.cssText = 'flex:1;overflow-y:auto;';
		this._table = $<HTMLElement>('div', 'dc-keybindings-table');
		scrollContainer.appendChild(this._table);
		this._container.appendChild(scrollContainer);
		parentDom.appendChild(this._container);

		this._register(addDisposableListener(this._searchInput, 'input', () => this._renderTable()));
		this._register(this._registry.onDidChange(() => this._renderTable()));
		this._renderTable();
	}

	get registry(): KeybindingRegistry {
		return this._registry;
	}

	public setQuery(query: string): void {
		this._searchInput.value = query;
		this._renderTable();
	}

	private _renderTable(): void {
		clearNode(this._table);

		const header = $<HTMLElement>('div', 'dc-keybindings-header');
		header.style.cssText = 'display:grid;grid-template-columns:1fr 220px 100px 90px;gap:8px;padding:8px 12px;border-bottom:1px solid #2a2d2e;';
		for (const label of ['Command', 'Keybinding', 'Source', 'Actions']) {
			const th = $<HTMLElement>('span');
			th.textContent = label;
			th.style.cssText = 'color:#bbbbbb;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:1px;user-select:none;';
			header.appendChild(th);
		}
		this._table.appendChild(header);

		const query = this._searchInput.value.trim().toLowerCase();
		const entries = this._registry.getEntries().filter(entry => {
			if (!query) {
				return true;
			}
			return entry.title.toLowerCase().includes(query)
				|| entry.commandId.toLowerCase().includes(query)
				|| entry.keybinding.toLowerCase().includes(query);
		});

		if (entries.length === 0) {
			const empty = $('div');
			empty.textContent = 'Tidak ada keybinding yang cocok';
			empty.style.cssText = 'padding:16px;color:#8a8a8a;font-size:13px;';
			this._table.appendChild(empty);
			return;
		}

		for (const entry of entries) {
			this._renderRow(entry);
		}
	}

	private _renderRow(entry: IKeybindingEntry): void {
		const row = $<HTMLElement>('div', 'dc-keybindings-row');
		row.style.cssText = 'display:grid;grid-template-columns:1fr 220px 100px 90px;gap:8px;padding:4px 12px;align-items:center;';
		row.dataset['commandId'] = entry.commandId;

		const command = $<HTMLElement>('span');
		command.textContent = entry.title;
		command.title = entry.commandId;
		command.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#cccccc;font-size:13px;';

		const keybinding = $<HTMLElement>('span', 'dc-keybinding-chord');
		keybinding.textContent = entry.keybinding || '(belum diatur)';
		keybinding.style.color = entry.keybinding ? '#cccccc' : '#6a6a6a';

		const source = $<HTMLElement>('span');
		source.textContent = entry.source === 'user' ? 'User' : 'Default';
		source.style.cssText = `font-size:11px;color:${entry.source === 'user' ? '#3794ff' : '#8a8a8a'};`;

		const actions = $<HTMLElement>('span');
		actions.style.cssText = 'display:flex;gap:6px;';

		const editButton = $<HTMLButtonElement>('button');
		editButton.textContent = '\u270E';
		editButton.title = 'Ubah keybinding';
		editButton.style.cssText = 'background:transparent;border:none;color:#cccccc;cursor:pointer;font-size:12px;';

		const resetButton = $<HTMLButtonElement>('button');
		resetButton.textContent = '\u21BA';
		resetButton.title = 'Reset ke default';
		resetButton.style.cssText = 'background:transparent;border:none;color:#8a8a8a;cursor:pointer;font-size:12px;';

		editButton.addEventListener('click', () => this._startRecording(entry.commandId, row, keybinding, editButton));
		resetButton.addEventListener('click', () => {
			this._registry.resetBinding(entry.commandId);
			editButton.style.color = '#cccccc';
		});

		actions.appendChild(editButton);
		if (entry.source === 'user') {
			actions.appendChild(resetButton);
		}

		row.appendChild(command);
		row.appendChild(keybinding);
		row.appendChild(source);
		row.appendChild(actions);
		this._table.appendChild(row);
	}

	private _startRecording(commandId: string, row: HTMLElement, keybindingEl: HTMLElement, editButton: HTMLButtonElement): void {
		if (this._recordingCommandId) {
			return;
		}
		this._recordingCommandId = commandId;
		keybindingEl.classList.add('dc-keybinding-record');
		keybindingEl.textContent = 'Tekan kombinasi tombol...';
		row.style.background = '#094771';
		editButton.textContent = 'Esc';
		editButton.style.color = '#ffffff';

		const onKeyDown = (e: KeyboardEvent) => {
			const kd = e;
			e.preventDefault();
			e.stopPropagation();
			if (kd.key === 'Escape') {
				this._finishRecording(row, keybindingEl, editButton);
				return;
			}
			const label = eventToKeybindingLabel(kd);
			if (label) {
				this._registry.setBinding(commandId, label);
				this._finishRecording(row, keybindingEl, editButton);
			}
		};
		const disposables = [
			addDisposableListener(window, 'keydown', ev => onKeyDown(ev as KeyboardEvent), true),
			addDisposableListener(window, 'blur', () => this._finishRecording(row, keybindingEl, editButton))
		];
		(this as unknown as { _recordingDisposables?: { dispose(): void }[] })._recordingDisposables = disposables;
	}

	private _finishRecording(row: HTMLElement, keybindingEl: HTMLElement, editButton: HTMLButtonElement): void {
		const disposables = (this as unknown as { _recordingDisposables?: { dispose(): void }[] })._recordingDisposables;
		if (disposables) {
			for (const d of disposables) {
				d.dispose();
			}
			(this as unknown as { _recordingDisposables?: { dispose(): void }[] })._recordingDisposables = undefined;
		}
		this._recordingCommandId = undefined;
		row.style.background = 'transparent';
		editButton.textContent = '\u270E';
		editButton.style.color = '#cccccc';
		keybindingEl.classList.remove('dc-keybinding-record');
		this._renderTable();
	}
}

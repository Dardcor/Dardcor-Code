/**
 * Dardcor Code - Status Bar Indentation Mode Selector (Spaces vs Tabs, Indent Size)
 */

import { Disposable, IDisposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { QuickPickItem } from '../../quickinput/quick-pick-item';
import { IQuickInputService } from '../../quickinput/quick-input-service';
import { EditorInput } from './editor-input';
import { IStatusbarEntry, StatusbarRegistry } from '../statusbar/statusbar-registry';
import { CommandRegistry } from '../../../services/commands/command-service';

export interface IIndentationInfo {
	readonly insertSpaces: boolean;
	readonly tabSize: number;
}

export interface IIndentationChangeEvent {
	readonly input: EditorInput;
	readonly from: IIndentationInfo;
	readonly to: IIndentationInfo;
}

export const DEFAULT_TAB_SIZE = 4;

export function detectIndentation(text: string): IIndentationInfo {
	const lines = text.split(/\r?\n/);
	const leading = lines
		.map(line => line.match(/^[ \t]+/)?.[0] ?? '')
		.filter(indent => indent.length > 0);

	if (leading.length === 0) {
		return { insertSpaces: true, tabSize: DEFAULT_TAB_SIZE };
	}

	const tabLeads = leading.filter(indent => indent.includes('\t'));
	if (tabLeads.length > leading.length / 2) {
		return { insertSpaces: false, tabSize: DEFAULT_TAB_SIZE };
	}

	const spaceLengths = leading
		.filter(indent => !indent.includes('\t'))
		.map(indent => indent.length);
	const unique = Array.from(new Set(spaceLengths)).sort((a, b) => a - b);
	let tabSize = DEFAULT_TAB_SIZE;
	if (unique.length > 0) {
		const candidates = [2, 4, 8].filter(c => unique.every(length => length % c === 0));
		tabSize = candidates[candidates.length - 1] ?? DEFAULT_TAB_SIZE;
	}
	return { insertSpaces: true, tabSize };
}

export function renderIndent(size: number, insertSpaces: boolean): string {
	return insertSpaces ? ' '.repeat(size) : '\t'.repeat(size);
}

export function getIndentationLabel(info: IIndentationInfo): string {
	return info.insertSpaces ? `Spaces: ${info.tabSize}` : `Tabs: ${info.tabSize}`;
}

export class EditorIndentation extends Disposable {
	private readonly _overrides = new Map<string, IIndentationInfo>();
	private _current: IIndentationInfo = { insertSpaces: true, tabSize: DEFAULT_TAB_SIZE };
	private _statusbarRegistration: IDisposable | null = null;

	private readonly _onDidChangeIndentation = this._register(new Emitter<IIndentationChangeEvent>());
	readonly onDidChangeIndentation: Event<IIndentationChangeEvent> = this._onDidChangeIndentation.event;

	constructor(
		private readonly _quickInput: IQuickInputService | null = null,
		private readonly _statusbar: StatusbarRegistry = StatusbarRegistry.instance
	) {
		super();
		this._register(CommandRegistry.registerCommand({
			id: 'workbench.action.editor.changeIndentation',
			handler: () => this.showIndentationPicker(null),
		}));
	}

	get currentIndentation(): IIndentationInfo {
		return { ...this._current };
	}

	getIndentationFor(input: EditorInput): IIndentationInfo {
		const override = this._overrides.get(input.toKey());
		if (override) {
			return override;
		}
		const model = input.getTextModel();
		return model ? detectIndentation(model.getValue()) : this._current;
	}

	setIndentation(input: EditorInput, info: IIndentationInfo): void {
		const from = this.getIndentationFor(input);
		if (from.insertSpaces === info.insertSpaces && from.tabSize === info.tabSize) {
			return;
		}
		const model = input.getTextModel();
		if (model) {
			model.setValue(this._reindentText(model.getValue(), from, info));
		}
		this._overrides.set(input.toKey(), { ...info });
		this._current = { ...info };
		this._onDidChangeIndentation.fire({ input, from, to: { ...info } });
	}

	removeOverride(input: EditorInput): void {
		this._overrides.delete(input.toKey());
	}

	createIndentationItems(current: IIndentationInfo): QuickPickItem[] {
		const items: QuickPickItem[] = [];
		for (const size of [2, 4, 8]) {
			items.push(new QuickPickItem({
				label: `Spaces: ${size}`,
				description: current.insertSpaces && current.tabSize === size ? 'Current' : undefined,
				icon: current.insertSpaces && current.tabSize === size ? '\u2713' : '',
				group: 'spaces',
				data: { insertSpaces: true, tabSize: size } as IIndentationInfo,
			}));
		}
		for (const size of [2, 4, 8]) {
			items.push(new QuickPickItem({
				label: `Tabs: ${size}`,
				description: !current.insertSpaces && current.tabSize === size ? 'Current' : undefined,
				icon: !current.insertSpaces && current.tabSize === size ? '\u2713' : '',
				group: 'tabs',
				data: { insertSpaces: false, tabSize: size } as IIndentationInfo,
			}));
		}
		return items;
	}

	async showIndentationPicker(input: EditorInput | null): Promise<IIndentationInfo | undefined> {
		if (!this._quickInput) {
			return undefined;
		}
		const current = input ? this.getIndentationFor(input) : this._current;
		const picked = await this._quickInput.openQuickPick<QuickPickItem>({
			title: 'Select Indentation',
			placeholder: 'Choose indentation mode and size for the active file',
			items: this.createIndentationItems(current),
		});
		const info = picked?.data as IIndentationInfo | undefined;
		if (info && input) {
			this.setIndentation(input, info);
		} else if (info) {
			this._current = { ...info };
		}
		return info;
	}

	updateStatusbar(entry: Pick<IStatusbarEntry, 'id' | 'alignment' | 'text' | 'tooltip' | 'commandId' | 'priority' | 'color'>): void {
		this._statusbarRegistration?.dispose();
		this._statusbarRegistration = this._statusbar.register({
			...entry,
			text: getIndentationLabel(this._current),
			tooltip: `Indentation: ${this._current.insertSpaces ? 'Spaces' : 'Tabs'} ${this._current.tabSize}`,
			commandId: 'workbench.action.editor.changeIndentation',
			priority: entry.priority ?? 0,
		});
	}

	private _reindentText(text: string, from: IIndentationInfo, to: IIndentationInfo): string {
		if (from.insertSpaces === to.insertSpaces && from.tabSize === to.tabSize) {
			return text;
		}
		const lines = text.split(/\r?\n/);
		const fromIndentUnit = renderIndent(from.tabSize, from.insertSpaces);
		const toIndentUnit = renderIndent(to.tabSize, to.insertSpaces);

		const convertIndent = (indent: string): string => {
			if (indent.length === 0) {
				return '';
			}
			const normalized = indent.replace(/\t/g, fromIndentUnit);
			let spaces = 0;
			for (const ch of normalized) {
				if (ch === ' ') {
					spaces++;
				} else {
					break;
				}
			}
			if (to.insertSpaces) {
				return ' '.repeat(Math.round(spaces / to.tabSize) * to.tabSize);
			}
			const tabs = Math.floor(spaces / to.tabSize);
			const remainder = spaces % to.tabSize;
			return '\t'.repeat(tabs) + ' '.repeat(remainder);
		};

		return lines
			.map(line => {
				const match = line.match(/^[ \t]*/);
				const indent = match?.[0] ?? '';
				return convertIndent(indent) + line.substring(indent.length);
			})
			.join('\n');
	}

	dispose(): void {
		this._statusbarRegistration?.dispose();
		this._statusbarRegistration = null;
		this._overrides.clear();
		super.dispose();
	}
}

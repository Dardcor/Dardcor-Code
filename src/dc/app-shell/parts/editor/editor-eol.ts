/**
 * Dardcor Code - Status Bar Line Ending Picker Switcher (LF vs CRLF)
 */

import { Disposable, IDisposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { QuickPickItem } from '../../quickinput/quick-pick-item';
import { IQuickInputService } from '../../quickinput/quick-input-service';
import { EditorInput } from './editor-input';
import { IStatusbarEntry, StatusbarRegistry } from '../statusbar/statusbar-registry';
import { CommandRegistry } from '../../../services/commands/command-service';

export const enum LineEnding {
	LF = 'LF',
	CRLF = 'CRLF',
}

export interface ILineEndingChangeEvent {
	readonly input: EditorInput;
	readonly from: LineEnding;
	readonly to: LineEnding;
}

export function detectLineEnding(text: string): LineEnding {
	const crlfCount = (text.match(/\r\n/g) ?? []).length;
	const lfCount = (text.match(/\n/g) ?? []).length;
	return crlfCount * 2 > lfCount ? LineEnding.CRLF : LineEnding.LF;
}

export function convertLineEnding(text: string, target: LineEnding): string {
	const normalized = text.replace(/\r\n/g, '\n');
	if (target === LineEnding.CRLF) {
		return normalized.replace(/\n/g, '\r\n');
	}
	return normalized;
}

export function getLineEndingLabel(eol: LineEnding): string {
	return eol === LineEnding.CRLF ? 'CRLF' : 'LF';
}

export class EditorEol extends Disposable {
	private readonly _overrides = new Map<string, LineEnding>();
	private _currentEol: LineEnding = LineEnding.LF;
	private _statusbarRegistration: IDisposable | null = null;

	private readonly _onDidChangeEol = this._register(new Emitter<ILineEndingChangeEvent>());
	readonly onDidChangeEol: Event<ILineEndingChangeEvent> = this._onDidChangeEol.event;

	constructor(
		private readonly _quickInput: IQuickInputService | null = null,
		private readonly _statusbar: StatusbarRegistry = StatusbarRegistry.instance
	) {
		super();
		this._register(CommandRegistry.registerCommand({
			id: 'workbench.action.editor.changeEol',
			handler: () => this.showEolPicker(null),
		}));
	}

	get currentEol(): LineEnding {
		return this._currentEol;
	}

	getEolFor(input: EditorInput): LineEnding {
		const override = this._overrides.get(input.toKey());
		if (override) {
			return override;
		}
		const model = input.getTextModel();
		return model ? detectLineEnding(model.getValue()) : this._currentEol;
	}

	setEol(input: EditorInput, eol: LineEnding): void {
		const from = this.getEolFor(input);
		if (from === eol) {
			return;
		}
		const model = input.getTextModel();
		if (model) {
			model.setValue(convertLineEnding(model.getValue(), eol));
		}
		this._overrides.set(input.toKey(), eol);
		this._currentEol = eol;
		this._onDidChangeEol.fire({ input, from, to: eol });
	}

	removeOverride(input: EditorInput): void {
		this._overrides.delete(input.toKey());
	}

	async showEolPicker(input: EditorInput | null): Promise<LineEnding | undefined> {
		if (!this._quickInput) {
			return undefined;
		}
		const current = input ? this.getEolFor(input) : this._currentEol;
		const items = [LineEnding.LF, LineEnding.CRLF].map(eol =>
			new QuickPickItem({
				label: getLineEndingLabel(eol),
				description: eol === current ? 'Current' : undefined,
				icon: eol === current ? '\u2713' : '',
				data: eol,
			})
		);
		const picked = await this._quickInput.openQuickPick<QuickPickItem>({
			title: 'Select End Of Line Sequence',
			placeholder: 'Choose LF (Unix) or CRLF (Windows) line endings',
			items,
		});
		const eol = picked?.data as LineEnding | undefined;
		if (eol && input) {
			this.setEol(input, eol);
		} else if (eol) {
			this._currentEol = eol;
		}
		return eol;
	}

	updateStatusbar(entry: Pick<IStatusbarEntry, 'id' | 'alignment' | 'text' | 'tooltip' | 'commandId' | 'priority' | 'color'>): void {
		this._statusbarRegistration?.dispose();
		this._statusbarRegistration = this._statusbar.register({
			...entry,
			text: getLineEndingLabel(this._currentEol),
			tooltip: `Line Ending: ${getLineEndingLabel(this._currentEol)}`,
			commandId: 'workbench.action.editor.changeEol',
			priority: entry.priority ?? 0,
		});
	}

	dispose(): void {
		this._statusbarRegistration?.dispose();
		this._statusbarRegistration = null;
		this._overrides.clear();
		super.dispose();
	}
}

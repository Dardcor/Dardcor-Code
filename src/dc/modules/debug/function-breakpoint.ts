/**
 * Dardcor Code - Execution Stop on Named Function Entry Breakpoint Controller
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';

export interface IFunctionBreakpoint {
	readonly id: string;
	readonly name: string;
	readonly enabled: boolean;
	readonly verified?: boolean;
}

export interface IFunctionBreakpointRequest {
	readonly breakpoints: readonly IFunctionBreakpoint[];
	readonly applied: boolean;
}

export class FunctionBreakpointController extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidApply = this._register(new Emitter<IFunctionBreakpointRequest>());
	readonly onDidApply: Event<IFunctionBreakpointRequest> = this._onDidApply.event;

	private readonly _breakpoints: IFunctionBreakpoint[] = [];
	private _idCounter = 1;

	public get breakpoints(): IFunctionBreakpoint[] {
		return [...this._breakpoints];
	}

	public get count(): number {
		return this._breakpoints.length;
	}

	public add(name: string): IFunctionBreakpoint | undefined {
		const trimmed = name.trim();
		if (!trimmed) {
			return undefined;
		}
		const existing = this._breakpoints.find(bp => bp.name === trimmed);
		if (existing) {
			return existing;
		}
		const bp: IFunctionBreakpoint = { id: `fn-bp-${this._idCounter++}`, name: trimmed, enabled: true };
		this._breakpoints.push(bp);
		this._notify();
		return bp;
	}

	public remove(id: string): void {
		const index = this._breakpoints.findIndex(bp => bp.id === id);
		if (index !== -1) {
			this._breakpoints.splice(index, 1);
			this._notify();
		}
	}

	public removeByName(name: string): void {
		const index = this._breakpoints.findIndex(bp => bp.name === name);
		if (index !== -1) {
			this._breakpoints.splice(index, 1);
			this._notify();
		}
	}

	public setEnabled(id: string, enabled: boolean): void {
		const bp = this._breakpoints.find(item => item.id === id);
		if (bp) {
			(bp as { enabled: boolean }).enabled = enabled;
			this._notify();
		}
	}

	public markVerified(id: string, verified: boolean): void {
		const bp = this._breakpoints.find(item => item.id === id);
		if (bp) {
			(bp as { verified?: boolean }).verified = verified;
			this._notify();
		}
	}

	public clearAll(): void {
		this._breakpoints.splice(0, this._breakpoints.length);
		this._notify();
	}

	public toDapBreakpoints(): { name: string; enabled: boolean }[] {
		return this._breakpoints.filter(bp => bp.enabled).map(bp => ({ name: bp.name, enabled: bp.enabled }));
	}

	public render(container: HTMLElement): void {
		clearNode(container);

		const inputRow = $<HTMLElement>('div');
		inputRow.style.cssText = 'display:flex;gap:4px;padding:6px 10px;';

		const input = $<HTMLInputElement>('input');
		input.placeholder = 'Nama fungsi (mis. main)';
		input.style.cssText = 'flex:1;background:#3c3c3c;border:none;border-radius:2px;color:#cccccc;font-size:12px;padding:4px 8px;outline:none;';

		const addBtn = $<HTMLButtonElement>('button');
		addBtn.textContent = '+';
		addBtn.title = 'Tambah function breakpoint';
		addBtn.style.cssText = 'background:#0e639c;border:none;color:white;border-radius:2px;font-size:12px;padding:2px 10px;cursor:pointer;';

		const commit = (): void => {
			const bp = this.add(input.value);
			if (bp) {
				input.value = '';
			}
		};
		this._register(addDisposableListener(addBtn, 'click', commit));
		this._register(addDisposableListener(input, 'keydown', (e) => {
			if ((e as KeyboardEvent).key === 'Enter') {
				commit();
			}
		}));
		inputRow.appendChild(input);
		inputRow.appendChild(addBtn);
		container.appendChild(inputRow);

		if (this._breakpoints.length === 0) {
			const empty = $('div');
			empty.textContent = 'Tidak ada function breakpoint.';
			empty.style.cssText = 'padding:8px 10px;color:#8a8a8a;font-size:12px;';
			container.appendChild(empty);
			return;
		}

		for (const bp of this._breakpoints) {
			const row = $<HTMLElement>('div');
			row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 10px;font-size:12px;color:#cccccc;';
			row.addEventListener('mouseenter', () => {
				row.style.background = '#2a2d2e';
			});
			row.addEventListener('mouseleave', () => {
				row.style.background = 'transparent';
			});

			const checkbox = $<HTMLInputElement>('input');
			checkbox.type = 'checkbox';
			checkbox.checked = bp.enabled;
			checkbox.style.cssText = 'accent-color:#007fd4;margin:0;';
			this._register(addDisposableListener(checkbox, 'change', () => this.setEnabled(bp.id, checkbox.checked)));

			const name = $<HTMLElement>('span');
			name.textContent = bp.name;
			name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:Consolas,monospace;';
			if (!bp.enabled) {
				name.style.opacity = '0.5';
			}

			const state = $<HTMLElement>('span');
			state.textContent = bp.verified === false ? '\u26A0' : bp.verified === true ? '\u2713' : '';
			state.style.cssText = `color:${bp.verified ? '#23d18b' : '#e5e510'};font-size:11px;width:14px;text-align:center;`;

			const removeBtn = $<HTMLButtonElement>('button');
			removeBtn.textContent = '\u2716';
			removeBtn.title = 'Hapus';
			removeBtn.style.cssText = 'background:transparent;border:none;color:#8a8a8a;cursor:pointer;font-size:10px;';
			this._register(addDisposableListener(removeBtn, 'click', () => this.remove(bp.id)));

			row.appendChild(checkbox);
			row.appendChild(name);
			row.appendChild(state);
			row.appendChild(removeBtn);
			container.appendChild(row);
		}
	}

	private _notify(): void {
		this._onDidChange.fire();
		this._onDidApply.fire({ breakpoints: this.breakpoints, applied: this._breakpoints.length > 0 });
	}
}

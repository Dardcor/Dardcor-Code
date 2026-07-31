import { Disposable, IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { createDecorator } from '../../services/instantiation/annotations.js';

export const IExtHostQuickOpen = createDecorator<IExtHostQuickOpen>('extHostQuickOpen');

export interface IQuickPickItem {
	label: string;
	description?: string;
	detail?: string;
}

export interface IQuickPickOptions {
	placeHolder?: string;
	canPickMany?: boolean;
	matchOnDescription?: boolean;
}

export interface IQuickInputOptions {
	placeHolder?: string;
	value?: string;
	password?: boolean;
	validateInput?: (value: string) => string | null | undefined | Promise<string | null | undefined>;
}

export interface IExtHostQuickOpen {
	showQuickPick<T extends IQuickPickItem | string>(items: T[] | Promise<T[]>, options?: IQuickPickOptions): Promise<T | T[] | undefined>;
	showInputBox(options?: IQuickInputOptions): Promise<string | undefined>;
}

const OVERLAY_STYLE = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.45);z-index:2147483646;display:flex;align-items:flex-start;justify-content:center;padding-top:12vh;';
const PANEL_STYLE = 'width:540px;max-width:92vw;background:#1e1e1e;color:#cccccc;border:1px solid #454545;border-radius:6px;box-shadow:0 12px 40px rgba(0,0,0,0.5);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;overflow:hidden;';
const INPUT_STYLE = 'width:100%;box-sizing:border-box;padding:10px 12px;background:#3c3c3c;color:#cccccc;border:none;outline:none;font-size:13px;';
const LIST_STYLE = 'max-height:320px;overflow-y:auto;';
const ROW_STYLE = 'padding:8px 12px;cursor:pointer;display:flex;gap:8px;align-items:center;';
const ACTIVE_ROW_BACKGROUND = '#094771';

export class ExtHostQuickOpen extends Disposable implements IExtHostQuickOpen {
	private _openOverlay: HTMLDivElement | undefined;
	private _pendingResolve: ((value: any) => void) | undefined;

	public showQuickPick<T extends IQuickPickItem | string>(items: T[] | Promise<T[]>, options?: IQuickPickOptions): Promise<T | T[] | undefined> {
		return Promise.resolve(items).then(list => this._showQuickPick(list, options));
	}

	public showInputBox(options?: IQuickInputOptions): Promise<string | undefined> {
		return new Promise<string | undefined>(resolve => {
			if (typeof document === 'undefined') {
				resolve(undefined);
				return;
			}
			const overlay = this._createOverlay();
			const panel = document.createElement('div');
			panel.style.cssText = PANEL_STYLE;
			const input = document.createElement('input');
			input.type = options?.password ? 'password' : 'text';
			input.value = options?.value ?? '';
			input.placeholder = options?.placeHolder ?? '';
			input.style.cssText = INPUT_STYLE;
			panel.appendChild(input);
			overlay.appendChild(panel);
			document.body.appendChild(overlay);
			input.focus();
			input.select();

			let done = false;
			const finish = (value: string | undefined): void => {
				if (done) {
					return;
				}
				done = true;
				this._pendingResolve = undefined;
				overlay.remove();
				resolve(value);
			};
			this._pendingResolve = finish;

			const onKeyDown = (event: KeyboardEvent): void => {
				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					finish(undefined);
					return;
				}
				if (event.key !== 'Enter') {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				const validate = options?.validateInput;
				if (!validate) {
					finish(input.value);
					return;
				}
				const result = validate(input.value);
				if (result && typeof (result as Promise<unknown>).then === 'function') {
					(result as Promise<string | null | undefined>).then(error => {
						if (!error) {
							finish(input.value);
						}
					});
				} else if (!result) {
					finish(input.value);
				}
			};
			input.addEventListener('keydown', onKeyDown);
		});
	}

	public isOpen(): boolean {
		return this._openOverlay !== undefined;
	}

	public closeCurrent(): void {
		const resolve = this._pendingResolve;
		this._pendingResolve = undefined;
		if (this._openOverlay) {
			this._openOverlay.remove();
			this._openOverlay = undefined;
		}
		resolve?.(undefined);
	}

	private _showQuickPick<T extends IQuickPickItem | string>(items: T[], options?: IQuickPickOptions): Promise<T | T[] | undefined> {
		return new Promise<T | T[] | undefined>(resolve => {
			if (typeof document === 'undefined') {
				resolve(undefined);
				return;
			}
			const overlay = this._createOverlay();
			const panel = document.createElement('div');
			panel.style.cssText = PANEL_STYLE;
			const input = document.createElement('input');
			input.placeholder = options?.placeHolder ?? 'Pilih item';
			input.style.cssText = INPUT_STYLE;
			const list = document.createElement('div');
			list.style.cssText = LIST_STYLE;
			panel.appendChild(input);
			panel.appendChild(list);
			overlay.appendChild(panel);
			document.body.appendChild(overlay);
			input.focus();

			let done = false;
			let activeIndex = 0;
			const selected = new Set<number>();

			const finish = (value: T | T[] | undefined): void => {
				if (done) {
					return;
				}
				done = true;
				this._pendingResolve = undefined;
				this._openOverlay = undefined;
				overlay.remove();
				resolve(value);
			};
			this._pendingResolve = finish;

			const labelOf = (item: T): string => typeof item === 'string' ? item : item.label;
			const descriptionOf = (item: T): string | undefined => typeof item === 'string' ? undefined : item.description;

			const filteredEntries = (): Array<{ item: T; index: number }> => {
				const query = input.value.toLowerCase();
				return items
					.map((item, index) => ({ item, index }))
					.filter(entry => {
						if (labelOf(entry.item).toLowerCase().includes(query)) {
							return true;
						}
						if (options?.matchOnDescription) {
							return (descriptionOf(entry.item)?.toLowerCase().includes(query) ?? false);
						}
						return false;
					});
			};

			const render = (): void => {
				const filtered = filteredEntries();
				if (activeIndex >= filtered.length) {
					activeIndex = Math.max(0, filtered.length - 1);
				}
				list.innerHTML = '';
				if (filtered.length === 0) {
					const empty = document.createElement('div');
					empty.textContent = 'Tidak ada item yang cocok';
					empty.style.cssText = 'padding:12px;opacity:0.7;';
					list.appendChild(empty);
					return;
				}
				filtered.forEach((entry, position) => {
					const isActive = position === activeIndex;
					const isChecked = selected.has(entry.index);
					const row = document.createElement('div');
					row.style.cssText = `${ROW_STYLE}background:${isActive ? ACTIVE_ROW_BACKGROUND : 'transparent'};`;
					row.dataset.index = String(position);
					const check = document.createElement('span');
					check.textContent = options?.canPickMany ? (isChecked ? '●' : '○') : '';
					check.style.cssText = 'width:14px;flex:none;';
					const label = document.createElement('span');
					label.textContent = labelOf(entry.item);
					label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
					const description = document.createElement('span');
					const descriptionText = descriptionOf(entry.item);
					if (descriptionText) {
						description.textContent = descriptionText;
						description.style.cssText = 'opacity:0.7;flex:none;';
					}
					row.appendChild(check);
					row.appendChild(label);
					row.appendChild(description);
					row.onmouseenter = () => {
						activeIndex = position;
						render();
					};
					row.onmousedown = (event) => {
						event.preventDefault();
						if (options?.canPickMany) {
							if (selected.has(entry.index)) {
								selected.delete(entry.index);
							} else {
								selected.add(entry.index);
							}
							activeIndex = position;
							render();
						} else {
							finish(entry.item);
						}
					};
					list.appendChild(row);
				});
			};

			const moveSelection = (delta: number): void => {
				const filtered = filteredEntries();
				if (filtered.length === 0) {
					return;
				}
				activeIndex = (activeIndex + delta + filtered.length) % filtered.length;
				render();
				const row = list.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
				row?.scrollIntoView({ block: 'nearest' });
			};

			const onKeyDown = (event: KeyboardEvent): void => {
				switch (event.key) {
					case 'Escape':
						event.preventDefault();
						event.stopPropagation();
						finish(undefined);
						break;
					case 'ArrowDown':
						event.preventDefault();
						moveSelection(1);
						break;
					case 'ArrowUp':
						event.preventDefault();
						moveSelection(-1);
						break;
					case 'Enter': {
						event.preventDefault();
						event.stopPropagation();
						const filtered = filteredEntries();
						const entry = filtered[activeIndex];
						if (!entry) {
							return;
						}
						if (options?.canPickMany) {
							selected.add(entry.index);
							finish([...selected].map(index => items[index]));
						} else {
							finish(entry.item);
						}
						break;
					}
					default:
						break;
				}
			};
			input.addEventListener('keydown', onKeyDown);
			input.addEventListener('input', () => {
				activeIndex = 0;
				render();
			});
			render();
		});
	}

	private _createOverlay(): HTMLDivElement {
		const overlay = document.createElement('div');
		overlay.style.cssText = OVERLAY_STYLE;
		this._openOverlay = overlay;
		overlay.addEventListener('mousedown', (event) => {
			if (event.target !== overlay) {
				return;
			}
			const resolve = this._pendingResolve;
			this._pendingResolve = undefined;
			this._openOverlay = undefined;
			overlay.remove();
			resolve?.(undefined);
		});
		return overlay;
	}
}

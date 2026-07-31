/**
 * Dardcor Code - Split Editor Vertical / Horizontal Action Commands
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $ } from '../../../core/dom/element';
import { Direction } from '../../layout/grid-layout';
import { CommandRegistry } from '../../../services/commands/command-service';

export interface IEditorGroupActionEvent {
	readonly action: 'splitVertical' | 'splitHorizontal' | 'closeGroup';
}

export class EditorGroupActions extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _buttons = new Map<string, HTMLElement>();

	private readonly _onDidSplit = this._register(new Emitter<Direction>());
	readonly onDidSplit: Event<Direction> = this._onDidSplit.event;

	private readonly _onDidInvokeAction = this._register(new Emitter<string>());
	readonly onDidInvokeAction: Event<string> = this._onDidInvokeAction.event;

	constructor(
		parent: HTMLElement,
		private readonly _options: { closeGroup?: boolean } = {}
	) {
		super();
		this._container = $<HTMLElement>('div', 'dc-editor-group-actions');
		this._container.style.cssText = 'display:flex;align-items:center;gap:2px;flex-shrink:0;';
		this._build();
		parent.appendChild(this._container);
	}

	get element(): HTMLElement {
		return this._container;
	}

	setVisible(visible: boolean): void {
		this._container.style.display = visible ? 'flex' : 'none';
	}

	private _build(): void {
		const specs: { id: string; icon: string; title: string; direction?: Direction }[] = [
			{ id: 'splitVertical', icon: '\u25ac\u25ac', title: 'Split Editor Up/Down (Ctrl+\\ )', direction: Direction.Down },
			{ id: 'splitHorizontal', icon: '\u2502\u2502', title: 'Split Editor Left/Right (Ctrl+Shift+\\ )', direction: Direction.Right },
		];
		if (this._options.closeGroup) {
			specs.push({ id: 'closeGroup', icon: '\u2715', title: 'Close Editor Group' });
		}
		for (const spec of specs) {
			const btn = $<HTMLElement>('span', 'dc-editor-group-action');
			btn.textContent = spec.icon;
			btn.title = spec.title;
			btn.dataset['actionId'] = spec.id;
			btn.style.cssText = 'cursor:pointer;color:#858585;font-size:10px;padding:2px 4px;border-radius:3px;';
			btn.addEventListener('mouseenter', () => {
				btn.style.background = '#3c3c3c';
			});
			btn.addEventListener('mouseleave', () => {
				btn.style.background = 'transparent';
			});
			btn.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				if (spec.direction !== undefined) {
					this._onDidSplit.fire(spec.direction);
				}
				this._onDidInvokeAction.fire(spec.id);
			});
			this._buttons.set(spec.id, btn);
			this._container.appendChild(btn);
		}
	}

	dispose(): void {
		this._container.remove();
		super.dispose();
	}
}

export namespace EditorGroupActionCommands {
	const _onDidInvoke = new Emitter<'splitVertical' | 'splitHorizontal'>();
	export const onDidInvoke: Event<'splitVertical' | 'splitHorizontal'> = _onDidInvoke.event;

	export function register(): { dispose(): void }[] {
		return [
			CommandRegistry.registerCommand({
				id: 'workbench.action.splitEditor',
				handler: () => _onDidInvoke.fire('splitHorizontal'),
			}),
			CommandRegistry.registerCommand({
				id: 'workbench.action.splitEditorOrthogonal',
				handler: () => _onDidInvoke.fire('splitVertical'),
			}),
		];
	}
}

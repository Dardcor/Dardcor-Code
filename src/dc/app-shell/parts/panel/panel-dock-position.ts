/**
 * Dardcor Code - Panel Placement Selector (Bottom, Left, Right)
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $ } from '../../../core/dom/element';
import { QuickPickItem } from '../../quickinput/quick-pick-item';
import { IQuickInputService } from '../../quickinput/quick-input-service';
import { PanelPosition } from './panel-actions';

export interface IPanelDockPositionOptions {
	readonly container: HTMLElement;
	readonly initialPosition?: PanelPosition;
}

export interface IPanelDockChangeEvent {
	readonly from: PanelPosition;
	readonly to: PanelPosition;
}

const POSITION_ORDER: PanelPosition[] = ['bottom', 'right', 'left'];

const POSITION_LABEL: Record<PanelPosition, string> = {
	bottom: 'Bottom',
	right: 'Right',
	left: 'Left',
};

const POSITION_ICON: Record<PanelPosition, string> = {
	bottom: '\u21e9',
	right: '\u21e8',
	left: '\u21e6',
};

export class PanelDockPosition extends Disposable {
	private readonly _container: HTMLElement;
	private _position: PanelPosition;

	private readonly _onDidChangePosition = this._register(new Emitter<IPanelDockChangeEvent>());
	readonly onDidChangePosition: Event<IPanelDockChangeEvent> = this._onDidChangePosition.event;

	constructor(options: IPanelDockPositionOptions) {
		super();
		this._container = options.container;
		this._position = options.initialPosition ?? 'bottom';
		this._apply();
	}

	get position(): PanelPosition {
		return this._position;
	}

	setPosition(position: PanelPosition): void {
		if (position === this._position) {
			return;
		}
		const from = this._position;
		this._position = position;
		this._apply();
		this._onDidChangePosition.fire({ from, to: position });
	}

	moveToBottom(): void {
		this.setPosition('bottom');
	}

	moveToRight(): void {
		this.setPosition('right');
	}

	moveToLeft(): void {
		this.setPosition('left');
	}

	cycle(): PanelPosition {
		const idx = POSITION_ORDER.indexOf(this._position);
		const next = POSITION_ORDER[(idx + 1) % POSITION_ORDER.length];
		this.setPosition(next);
		return next;
	}

	toggleHorizontalVertical(): PanelPosition {
		const next = this._position === 'bottom' ? 'right' : 'bottom';
		this.setPosition(next);
		return next;
	}

	getOptions(): { position: PanelPosition; label: string; icon: string }[] {
		return POSITION_ORDER.map(position => ({
			position,
			label: POSITION_LABEL[position],
			icon: POSITION_ICON[position],
		}));
	}

	createQuickPickItems(): QuickPickItem[] {
		return this.getOptions().map(option =>
			new QuickPickItem({
				label: option.label,
				description: option.position === this._position ? 'Current' : undefined,
				icon: option.icon,
				data: option.position,
			})
		);
	}

	async showPicker(quickInput: IQuickInputService): Promise<PanelPosition | undefined> {
		const items = this.createQuickPickItems();
		const picked = await quickInput.openQuickPick<QuickPickItem>({
			title: 'Select Panel Position',
			placeholder: 'Dock the panel to the bottom, right, or left',
			items,
		});
		const position = picked?.data as PanelPosition | undefined;
		if (position) {
			this.setPosition(position);
		}
		return position;
	}

	private _apply(): void {
		this._container.classList.toggle('dc-panel-dock-bottom', this._position === 'bottom');
		this._container.classList.toggle('dc-panel-dock-right', this._position === 'right');
		this._container.classList.toggle('dc-panel-dock-left', this._position === 'left');

		const el = this._container;
		if (this._position === 'bottom') {
			el.style.width = 'auto';
			el.style.height = '';
			el.style.position = '';
			el.style.bottom = '';
			el.style.right = '';
		} else if (this._position === 'right') {
			el.style.position = 'absolute';
			el.style.top = '0';
			el.style.right = '0';
			el.style.bottom = '0';
			el.style.height = '100%';
			el.style.width = '300px';
		} else if (this._position === 'left') {
			el.style.position = 'absolute';
			el.style.top = '0';
			el.style.left = '0';
			el.style.bottom = '0';
			el.style.height = '100%';
			el.style.width = '300px';
		}
	}

	dispose(): void {
		super.dispose();
	}
}

export function createPanelDockBadge(position: PanelPosition): HTMLElement {
	const badge = $<HTMLElement>('span', 'dc-panel-dock-badge');
	badge.textContent = `${POSITION_ICON[position]} ${POSITION_LABEL[position]}`;
	badge.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#cccccc;background:#252526;border:1px solid #3c3c3c;border-radius:10px;padding:2px 8px;user-select:none;';
	return badge;
}

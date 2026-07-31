/**
 * Dardcor Code - Vertical Positioning Calculator For Activity Bar
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { $ } from '../../../core/dom/element';

export interface IActivityBarMetrics {
	readonly width: number;
	readonly actionHeight: number;
	readonly actionSpacing: number;
	readonly topPadding: number;
	readonly bottomPadding: number;
}

export interface IActivityPosition {
	readonly index: number;
	readonly y: number;
	readonly height: number;
	readonly isTop: boolean;
}

export interface IActivitybarLayoutOptions extends Partial<IActivityBarMetrics> {
	readonly container?: HTMLElement;
	readonly actionCount?: number;
}

export class ActivitybarLayout extends Disposable {
	private readonly _container: HTMLElement | null;
	private _metrics: IActivityBarMetrics;
	private _actionCount = 0;
	private _bottomActionCount = 0;
	private _availableHeight = 0;

	constructor(options: IActivitybarLayoutOptions = {}) {
		super();
		this._container = options.container ?? (typeof document !== 'undefined' ? $<HTMLElement>('div', 'dc-activitybar-layout') : null);
		this._metrics = {
			width: options.width ?? 48,
			actionHeight: options.actionHeight ?? 42,
			actionSpacing: options.actionSpacing ?? 2,
			topPadding: options.topPadding ?? 8,
			bottomPadding: options.bottomPadding ?? 6,
		};
		this._actionCount = options.actionCount ?? 0;
	}

	get metrics(): IActivityBarMetrics {
		return { ...this._metrics };
	}

	get actionCount(): number {
		return this._actionCount;
	}

	setActionCount(count: number): void {
		this._actionCount = Math.max(0, count);
	}

	setBottomActionCount(count: number): void {
		this._bottomActionCount = Math.max(0, count);
	}

	setAvailableHeight(height: number): void {
		this._availableHeight = Math.max(0, height);
	}

	getActionPosition(index: number): IActivityPosition {
		const { actionHeight, actionSpacing, topPadding } = this._metrics;
		return {
			index,
			y: topPadding + index * (actionHeight + actionSpacing),
			height: actionHeight,
			isTop: true,
		};
	}

	getBottomActionPositions(): IActivityPosition[] {
		const positions: IActivityPosition[] = [];
		const { actionHeight, actionSpacing, bottomPadding } = this._metrics;
		for (let i = 0; i < this._bottomActionCount; i++) {
			const bottomY = this._availableHeight - bottomPadding - (this._bottomActionCount - i) * actionHeight - (this._bottomActionCount - 1 - i) * actionSpacing;
			positions.push({ index: i, y: bottomY, height: actionHeight, isTop: false });
		}
		return positions;
	}

	computeTopActionPositions(): IActivityPosition[] {
		const positions: IActivityPosition[] = [];
		for (let i = 0; i < this._actionCount; i++) {
			positions.push(this.getActionPosition(i));
		}
		return positions;
	}

	computeBadgePosition(actionIndex: number): { x: number; y: number } {
		const { width, actionHeight, actionSpacing, topPadding } = this._metrics;
		return {
			x: width - 14,
			y: topPadding + actionIndex * (actionHeight + actionSpacing) + 2,
		};
	}

	apply(actions: HTMLElement[], bottomActions: HTMLElement[] = []): void {
		const positions = this.computeTopActionPositions();
		actions.forEach((action, index) => {
			const pos = positions[index];
			if (pos) {
				action.style.position = 'absolute';
				action.style.left = '0';
				action.style.top = `${pos.y}px`;
				action.style.height = `${pos.height}px`;
			}
		});

		const bottomPositions = this.getBottomActionPositions();
		bottomActions.forEach((action, index) => {
			const pos = bottomPositions[index];
			if (pos) {
				action.style.position = 'absolute';
				action.style.left = '0';
				action.style.top = `${pos.y}px`;
				action.style.height = `${pos.height}px`;
			}
		});

		if (this._container) {
			this._container.style.position = 'relative';
			this._container.style.width = `${this._metrics.width}px`;
		}
	}

	static readonly DEFAULT_METRICS: IActivityBarMetrics = {
		width: 48,
		actionHeight: 42,
		actionSpacing: 2,
		topPadding: 8,
		bottomPadding: 6,
	};
}

export interface IActivitybarLayoutResult {
	readonly topActions: IActivityPosition[];
	readonly bottomActions: IActivityPosition[];
	readonly totalUsedHeight: number;
	readonly overflow: boolean;
}

export function computeActivitybarLayout(actionCount: number, bottomActionCount: number, availableHeight: number, metrics: IActivityBarMetrics = ActivitybarLayout.DEFAULT_METRICS): IActivitybarLayoutResult {
	const layout = new ActivitybarLayout({ ...metrics });
	layout.setActionCount(actionCount);
	layout.setBottomActionCount(bottomActionCount);
	layout.setAvailableHeight(availableHeight);
	const topActions = layout.computeTopActionPositions();
	const bottomActions = layout.getBottomActionPositions();
	const lastTop = topActions[topActions.length - 1];
	const lastBottom = bottomActions[0];
	const totalUsedHeight = lastBottom
		? (lastTop ? lastTop.y + lastTop.height : 0) + (availableHeight - lastBottom.y) - metrics.bottomPadding
		: (lastTop?.y ?? 0) + (lastTop?.height ?? 0) + metrics.bottomPadding;
	return {
		topActions,
		bottomActions,
		totalUsedHeight,
		overflow: totalUsedHeight > availableHeight,
	};
}

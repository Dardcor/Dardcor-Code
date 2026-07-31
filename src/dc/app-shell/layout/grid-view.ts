/**
 * Dardcor Code - 2D Flex Layout Calculation View Model
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $ } from '../../core/dom/element';
import { Direction } from './grid-layout';

export interface IGridLeaf {
	readonly id: string;
	readonly view: HTMLElement;
	size: number;
	minSize: number;
}

export interface IGridRow {
	readonly id: string;
	height: number;
	readonly columns: IGridLeaf[];
}

export interface IGridRect {
	readonly id: string;
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

export interface IGridLayoutResult {
	readonly rects: IGridRect[];
	readonly width: number;
	readonly height: number;
}

const DEFAULT_MIN = 60;

export function clampSize(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * Distributes a total length among children honoring each minimum size.
 * Returns pixel lengths that sum exactly to `total`.
 */
export function computeFlexLengths(total: number, sizes: number[], mins: number[]): number[] {
	if (sizes.length === 0) {
		return [];
	}
	const sum = sizes.reduce((a, b) => a + b, 0) || 1;
	const raw = sizes.map(s => (s / sum) * total);
	const clamped = raw.map((v, i) => clampSize(v, mins[i], total));
	const clampedSum = clamped.reduce((a, b) => a + b, 0);
	const overflow = clampedSum - total;
	if (Math.abs(overflow) < 1 || clampedSum === 0) {
		return clamped;
	}
	// Distribute overflow/underflow proportionally among non-clamped children.
	const freeIndexes = clamped.map((v, i) => (v === mins[i] ? -1 : i)).filter(i => i !== -1);
	if (freeIndexes.length === 0) {
		return clamped;
	}
	const freeSum = freeIndexes.reduce((a, i) => a + raw[i], 0) || 1;
	const result = [...clamped];
	for (const i of freeIndexes) {
		result[i] = clampSize(raw[i] - (overflow * raw[i]) / freeSum, mins[i], total);
	}
	// Compensate rounding drift.
	const drift = total - result.reduce((a, b) => a + b, 0);
	if (Math.abs(drift) > 0.5 && freeIndexes.length > 0) {
		result[freeIndexes[freeIndexes.length - 1]] += drift;
	}
	return result;
}

let rowCounter = 0;
let leafCounter = 0;

export class GridView extends Disposable {
	private readonly _rows: IGridRow[] = [];
	private _width = 0;
	private _height = 0;
	private _minRowSize = 80;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(
		private readonly _container: HTMLElement,
		private readonly _minLeafSize = DEFAULT_MIN
	) {
		super();
	}

	get rows(): IGridRow[] {
		return this._rows;
	}

	get width(): number {
		return this._width;
	}

	get height(): number {
		return this._height;
	}

	get empty(): boolean {
		return this._rows.length === 0;
	}

	getLeaf(id: string): IGridLeaf | null {
		for (const row of this._rows) {
			const leaf = row.columns.find(c => c.id === id);
			if (leaf) {
				return leaf;
			}
		}
		return null;
	}

	containsView(view: HTMLElement): boolean {
		for (const row of this._rows) {
			if (row.columns.some(c => c.view === view)) {
				return true;
			}
		}
		return false;
	}

	addView(view: HTMLElement, relativeToId?: string, direction: Direction = Direction.Right, size = 0.5): string {
		const id = `grid-view-leaf-${++leafCounter}`;
		const leaf: IGridLeaf = { id, view, size, minSize: this._minLeafSize };

		if (this._rows.length === 0) {
			const row = this._createRow(1);
			row.columns.push(leaf);
			this._rows.push(row);
		} else {
			const targetRow = this._rowOf(relativeToId);
			const targetIndex = targetRow ? targetRow.columns.findIndex(c => c.id === relativeToId) : -1;
			const vertical = direction === Direction.Up || direction === Direction.Down;

			if (vertical) {
				const newRow = this._createRow(size);
				newRow.columns.push(leaf);
				const target = targetRow ?? this._rows[0];
				const targetRowHeight = target.height;
				target.height = targetRowHeight * (1 - size);
				const insertIndex = direction === Direction.Up ? this._rows.indexOf(target) : this._rows.indexOf(target) + 1;
				this._rows.splice(insertIndex, 0, newRow);
			} else {
				const row = targetRow ?? this._rows[0];
				const insertIndex = targetIndex === -1 ? row.columns.length : targetIndex + (direction === Direction.Right ? 1 : 0);
				row.columns.splice(insertIndex, 0, leaf);
			}
		}

		this.layout();
		this._onDidChange.fire();
		return id;
	}

	removeView(id: string): void {
		for (let r = 0; r < this._rows.length; r++) {
			const row = this._rows[r];
			const index = row.columns.findIndex(c => c.id === id);
			if (index === -1) {
				continue;
			}
			const [removed] = row.columns.splice(index, 1);
			removed.view.remove();
			if (row.columns.length === 0) {
				this._rows.splice(r, 1);
				this._rebalanceRows();
			}
			this.layout();
			this._onDidChange.fire();
			return;
		}
	}

	clear(): void {
		for (const row of this._rows) {
			for (const col of row.columns) {
				col.view.remove();
			}
		}
		this._rows.length = 0;
		this.layout();
		this._onDidChange.fire();
	}

	getSize(id: string): { width: number; height: number } {
		const rect = this.getRect(id);
		return rect ? { width: rect.width, height: rect.height } : { width: 0, height: 0 };
	}

	getRect(id: string): IGridRect | null {
		const result = this.computeLayout(this._width, this._height);
		return result.rects.find(r => r.id === id) ?? null;
	}

	resizeView(id: string, delta: number, horizontal: boolean): void {
		for (const row of this._rows) {
			const index = row.columns.findIndex(c => c.id === id);
			if (index === -1) {
				continue;
			}
			const current = row.columns[index];
			const minFrac = current.minSize / (horizontal ? this._width : this._height);
			if (horizontal) {
				const sibling = row.columns[index + 1];
				if (!sibling) {
					return;
				}
				const newSize = clampSize(current.size + delta / Math.max(this._width, 1), minFrac, 1 - minFrac);
				current.size = newSize;
				sibling.size = 1 - newSize;
			} else {
				const rowIndex = this._rows.indexOf(row);
				const sibling = this._rows[rowIndex + 1];
				if (!sibling) {
					return;
				}
				const newHeight = clampSize(row.height + delta / Math.max(this._height, 1), minFrac, 1 - minFrac);
				row.height = newHeight;
				sibling.height = 1 - newHeight;
			}
			this.layout();
			this._onDidChange.fire();
			return;
		}
	}

	layout(width?: number, height?: number): IGridLayoutResult {
		this._width = width ?? this._container.clientWidth;
		this._height = height ?? this._container.clientHeight;
		const result = this.computeLayout(this._width, this._height);
		this._applyRects(result.rects);
		return result;
	}

	computeLayout(width: number, height: number): IGridLayoutResult {
		const rects: IGridRect[] = [];
		if (width <= 0 || height <= 0 || this._rows.length === 0) {
			return { rects, width, height };
		}
		const rowHeights = computeFlexLengths(height, this._rows.map(r => r.height), this._rows.map(() => this._minRowSize));
		let accY = 0;
		for (let r = 0; r < this._rows.length; r++) {
			const row = this._rows[r];
			const rowHeight = rowHeights[r];
			const colWidths = computeFlexLengths(width, row.columns.map(c => c.size), row.columns.map(c => c.minSize));
			let accX = 0;
			for (let c = 0; c < row.columns.length; c++) {
				const col = row.columns[c];
				const colWidth = colWidths[c];
				rects.push({ id: col.id, left: accX, top: accY, width: colWidth, height: rowHeight });
				accX += colWidth;
			}
			accY += rowHeight;
		}
		return { rects, width, height };
	}

	private _applyRects(rects: IGridRect[]): void {
		for (const rect of rects) {
			const leaf = this.getLeaf(rect.id);
			if (!leaf) {
				continue;
			}
			const el = leaf.view;
			el.style.position = 'absolute';
			el.style.left = `${rect.left}px`;
			el.style.top = `${rect.top}px`;
			el.style.width = `${rect.width}px`;
			el.style.height = `${rect.height}px`;
		}
	}

	private _createRow(height: number): IGridRow {
		const row: IGridRow = { id: `grid-view-row-${++rowCounter}`, height, columns: [] };
		const rowEl = $<HTMLElement>('div', 'dc-grid-view-row');
		rowEl.style.cssText = 'position:absolute;display:flex;overflow:hidden;';
		this._container.appendChild(rowEl);
		return row;
	}

	private _rowOf(leafId: string | undefined): IGridRow | null {
		if (!leafId) {
			return null;
		}
		return this._rows.find(row => row.columns.some(c => c.id === leafId)) ?? null;
	}

	private _rebalanceRows(): void {
		const total = this._rows.reduce((a, r) => a + r.height, 0);
		if (total <= 0) {
			return;
		}
		for (const row of this._rows) {
			row.height /= total;
		}
	}

	dispose(): void {
		this.clear();
		super.dispose();
	}
}

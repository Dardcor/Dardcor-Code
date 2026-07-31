/**
 * Dardcor Code - N-Way Grid Editor Group Splitter Layout Calculation
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { Direction } from '../../layout/grid-layout.js';

export interface IGridCell {
	readonly index: number;
	readonly row: number;
	readonly column: number;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface IGridDimensions {
	readonly rows: number;
	readonly columns: number;
	readonly cellWidth: number;
	readonly cellHeight: number;
}

export interface IEditorGroupGridOptions {
	readonly columns?: number;
	readonly gap?: number;
}

export class EditorGroupGrid extends Disposable {
	private readonly _columns: number;
	private readonly _gap: number;
	private readonly _cells: IGridCell[] = [];

	private readonly _onDidChange = this._register(new Emitter<IGridCell[]>());
	readonly onDidChange: Event<IGridCell[]> = this._onDidChange.event;

	constructor(options: IEditorGroupGridOptions = {}) {
		super();
		this._columns = Math.max(1, options.columns ?? 2);
		this._gap = Math.max(0, options.gap ?? 0);
	}

	get cells(): IGridCell[] {
		return [...this._cells];
	}

	get count(): number {
		return this._cells.length;
	}

	clear(): void {
		this._cells.length = 0;
		this._onDidChange.fire([]);
	}

	setGroupCount(count: number, containerWidth: number, containerHeight: number): IGridCell[] {
		this._cells.length = 0;
		const cells = EditorGroupGrid.computeGrid(count, containerWidth, containerHeight, this._columns, this._gap);
		this._cells.push(...cells);
		this._onDidChange.fire(this._cells);
		return cells;
	}

	getCell(index: number): IGridCell | undefined {
		return this._cells[index];
	}

	getCellContainingPoint(x: number, y: number): IGridCell | undefined {
		return this._cells.find(cell =>
			x >= cell.x && x <= cell.x + cell.width &&
			y >= cell.y && y <= cell.y + cell.height
		);
	}

	getSplitTargets(groupCount: number): { index: number; direction: Direction }[] {
		return EditorGroupGrid.computeSplitTargets(groupCount, this._columns);
	}

	static computeDimensions(count: number, columns: number): IGridDimensions {
		const safeColumns = Math.max(1, Math.min(columns, Math.max(1, count)));
		const rows = Math.max(1, Math.ceil(count / safeColumns));
		return { rows, columns: safeColumns, cellWidth: 0, cellHeight: 0 };
	}

	static computeGrid(count: number, containerWidth: number, containerHeight: number, columns = 2, gap = 0): IGridCell[] {
		const n = Math.max(1, count);
		const safeColumns = Math.max(1, Math.min(columns, n));
		const rows = Math.ceil(n / safeColumns);
		const totalGapX = gap * (safeColumns - 1);
		const totalGapY = gap * (rows - 1);
		const cellWidth = (containerWidth - totalGapX) / safeColumns;
		const cellHeight = (containerHeight - totalGapY) / rows;

		const cells: IGridCell[] = [];
		for (let i = 0; i < n; i++) {
			const row = Math.floor(i / safeColumns);
			const col = i % safeColumns;
			cells.push({
				index: i,
				row,
				column: col,
				x: col * (cellWidth + gap),
				y: row * (cellHeight + gap),
				width: cellWidth,
				height: cellHeight,
			});
		}
		return cells;
	}

	static computeSplitTargets(groupCount: number, columns = 2): { index: number; direction: Direction }[] {
		const targets: { index: number; direction: Direction }[] = [];
		const n = Math.max(1, groupCount);
		const safeColumns = Math.max(1, Math.min(columns, n));
		const rows = Math.ceil(n / safeColumns);
		const lastRowCount = n - (rows - 1) * safeColumns;

		if (lastRowCount < safeColumns) {
			targets.push({ index: n - 1, direction: Direction.Right });
		}
		if (n % safeColumns !== 0) {
			const startIdx = (rows - 1) * safeColumns;
			for (let i = startIdx; i < n; i++) {
				targets.push({ index: i, direction: Direction.Down });
			}
		} else {
			targets.push({ index: n - 1, direction: Direction.Down });
		}
		return targets;
	}

	static computeInsertionPoint(groupCount: number, columns = 2): { index: number; direction: Direction } {
		const n = Math.max(1, groupCount);
		const safeColumns = Math.max(1, Math.min(columns, n));
		const rows = Math.ceil(n / safeColumns);
		const lastRowCount = n - (rows - 1) * safeColumns;
		if (lastRowCount < safeColumns) {
			return { index: n - 1, direction: Direction.Right };
		}
		return { index: n - 1, direction: Direction.Down };
	}

	dispose(): void {
		this._cells.length = 0;
		super.dispose();
	}
}

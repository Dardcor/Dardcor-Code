/**
 * Dardcor Code - Tab Character Column Offset Mapper (Task 236)
 * Mirrors: vs/editor/common/core/position.ts & cursorMoveOperations.ts (column math)
 */

export class CursorColumn {
	public static getColumnAtOffset(line: string, offset: number, tabSize: number): number {
		const clamped = Math.max(0, Math.min(line.length, offset));
		let column = 1;
		for (let i = 0; i < clamped; i++) {
			if (line.charCodeAt(i) === 9 /* Tab */) {
				column += tabSize - ((column - 1) % tabSize);
			} else {
				column += 1;
			}
		}
		return column;
	}

	public static getOffsetAtColumn(line: string, column: number, tabSize: number): number {
		let currentColumn = 1;
		for (let i = 0; i < line.length; i++) {
			if (currentColumn >= column) {
				return i;
			}
			if (line.charCodeAt(i) === 9 /* Tab */) {
				currentColumn += tabSize - ((currentColumn - 1) % tabSize);
			} else {
				currentColumn += 1;
			}
		}
		return line.length;
	}

	public static getVisibleColumn(line: string, column: number, tabSize: number): number {
		return CursorColumn.getColumnAtOffset(line, CursorColumn.getOffsetAtColumn(line, column, tabSize), tabSize);
	}

	public static getColumnX(line: string, column: number, tabSize: number, charWidth: number): number {
		return (CursorColumn.getColumnAtOffset(line, CursorColumn.getOffsetAtColumn(line, column, tabSize), tabSize) - 1) * charWidth;
	}

	public static getColumnAtX(line: string, x: number, tabSize: number, charWidth: number): number {
		const targetColumn = Math.max(0, Math.floor(x / Math.max(1, charWidth))) + 1;
		return CursorColumn.getColumnAtOffset(line, CursorColumn.getOffsetAtColumn(line, targetColumn, tabSize), tabSize);
	}

	public static getMaxColumn(line: string, tabSize: number): number {
		return CursorColumn.getColumnAtOffset(line, line.length, tabSize);
	}

	public static getMinColumn(): number {
		return 1;
	}

	public static normalizeColumn(line: string, column: number, tabSize: number): number {
		const offset = CursorColumn.getOffsetAtColumn(line, column, tabSize);
		return CursorColumn.getColumnAtOffset(line, offset, tabSize);
	}

	public static staticTabStop(column: number, tabSize: number): number {
		return column + (tabSize - ((column - 1) % tabSize));
	}

	public static isTabStopPosition(line: string, column: number, tabSize: number): boolean {
		const offset = CursorColumn.getOffsetAtColumn(line, column, tabSize);
		if (offset >= line.length || line.charCodeAt(offset) !== 9 /* Tab */) {
			return false;
		}
		return CursorColumn.getColumnAtOffset(line, offset, tabSize) === column;
	}
}

import { RemotePty, RemotePtyClient } from './remote-pty-service';
import { RemoteTerminalProcess } from './remote-terminal-process';

export interface ITerminalSize {
	readonly cols: number;
	readonly rows: number;
}

export interface IResizableTarget {
	resize(cols: number, rows: number): void;
}

export const MIN_COLS = 1;
export const MIN_ROWS = 1;
export const MAX_COLS = 500;
export const MAX_ROWS = 200;
export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;

export function clampCols(cols: number): number {
	return Math.max(MIN_COLS, Math.min(MAX_COLS, Math.round(cols)));
}

export function clampRows(rows: number): number {
	return Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.round(rows)));
}

export function clampSize(cols: number, rows: number): ITerminalSize {
	return { cols: clampCols(cols), rows: clampRows(rows) };
}

export function isResizable(target: unknown): target is IResizableTarget {
	return !!target && typeof (target as IResizableTarget).resize === 'function';
}

export class RemoteTerminalResize {
	resize(target: RemotePty | RemoteTerminalProcess | RemotePtyClient | IResizableTarget | { resize(cols: number, rows: number): Promise<unknown> }, cols: number, rows: number): void {
		const size = clampSize(cols, rows);
		if (!isResizable(target)) {
			throw new Error('Target is not resizable: missing resize(cols, rows) method');
		}
		target.resize(size.cols, size.rows);
	}

	async resizeAsync(target: RemotePtyClient, id: string, cols: number, rows: number): Promise<void> {
		const size = clampSize(cols, rows);
		await target.resize(id, size.cols, size.rows);
	}

	clamp(cols: number, rows: number): ITerminalSize {
		return clampSize(cols, rows);
	}

	getDefaultSize(): ITerminalSize {
		return { cols: DEFAULT_COLS, rows: DEFAULT_ROWS };
	}

	getSizeFromElement(element: HTMLElement | null, fontSize = 14): ITerminalSize {
		if (!element) {
			return this.getDefaultSize();
		}
		const rect = element.getBoundingClientRect();
		const cols = Math.floor(rect.width / (fontSize * 0.6));
		const rows = Math.floor(rect.height / (fontSize * 1.4));
		return clampSize(cols, rows);
	}

	getFittedSize(current: ITerminalSize, available: ITerminalSize): ITerminalSize {
		return clampSize(Math.min(current.cols, available.cols), Math.min(current.rows, available.rows));
	}

	shouldResize(current: ITerminalSize, next: ITerminalSize): boolean {
		return current.cols !== next.cols || current.rows !== next.rows;
	}

	debouncedResize(target: IResizableTarget, cols: number, rows: number, delayMs = 100): () => void {
		let timer: ReturnType<typeof setTimeout> | null = null;
		return () => {
			if (timer) {
				clearTimeout(timer);
			}
			timer = setTimeout(() => {
				this.resize(target, cols, rows);
				timer = null;
			}, delayMs);
		};
	}
}

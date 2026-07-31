/**
 * Dardcor Code - Xterm.js Canvas Terminal Emulator Renderer (built-in, tanpa dependensi)
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface ITerminalCell {
	ch: string;
	fg: number;
	bg: number;
	bold: boolean;
}

export const TERMINAL_DEFAULT_BG = '#000000';
export const TERMINAL_DEFAULT_FG = '#cccccc';

export const TERMINAL_PALETTE: string[] = [
	'#000000', '#ff5252', '#69f0ae', '#ffd740', '#7c4dff', '#e040fb', '#18ffff', '#e5e5e5',
	'#666666', '#ff8a80', '#b9f6ca', '#ffe57f', '#b388ff', '#ea80fc', '#84ffff', '#ffffff'
];

function createEmptyCell(fg: number, bg: number, bold: boolean): ITerminalCell {
	return { ch: ' ', fg, bg, bold };
}

export function get256Color(index: number): string {
	if (index < 16) {
		return TERMINAL_PALETTE[index];
	}
	if (index < 232) {
		const value = index - 16;
		const r = Math.floor(value / 36);
		const g = Math.floor((value % 36) / 6);
		const b = value % 6;
		const to = (v: number): number => (v === 0 ? 0 : 55 + v * 40);
		return `rgb(${to(r)},${to(g)},${to(b)})`;
	}
	const gray = 8 + (index - 232) * 10;
	return `rgb(${gray},${gray},${gray})`;
}

export const MAX_SCROLLBACK_ROWS = 5000;

export class TerminalEmulator extends Disposable {
	private readonly _onBell = this._register(new Emitter<void>());
	readonly onBell: Event<void> = this._onBell.event;

	private readonly _onTitleChange = this._register(new Emitter<string>());
	readonly onTitleChange: Event<string> = this._onTitleChange.event;

	private _cols = 80;
	private _rows = 24;
	private _buffer: ITerminalCell[][] = [];
	private _cursorX = 0;
	private _cursorY = 0;
	private _fg = 7;
	private _bg = 0;
	private _bold = false;
	private _cursorVisible = true;

	private _escapeState: 'normal' | 'escape' | 'csi' | 'osc' = 'normal';
	private _csiParams: number[] = [];
	private _csiIntermediate = '';
	private _oscBuffer = '';

	constructor(cols = 80, rows = 24) {
		super();
		this._cols = cols;
		this._rows = rows;
		this._initBuffer();
	}

	get cols(): number {
		return this._cols;
	}

	get rows(): number {
		return this._rows;
	}

	get cursorX(): number {
		return this._cursorX;
	}

	get cursorY(): number {
		return this._cursorY;
	}

	get cursorVisible(): boolean {
		return this._cursorVisible;
	}

	get totalRows(): number {
		return this._buffer.length;
	}

	private _initBuffer(): void {
		this._buffer = [];
		for (let i = 0; i < this._rows; i++) {
			this._buffer.push([]);
		}
		this._cursorX = 0;
		this._cursorY = 0;
	}

	public resize(cols: number, rows: number): void {
		if (cols < 2 || rows < 1) {
			return;
		}
		if (cols === this._cols && rows === this._rows) {
			return;
		}
		this._cols = cols;
		this._rows = rows;
		while (this._buffer.length < this._rows) {
			this._buffer.unshift([]);
		}
		this._buffer = this._buffer.slice(-MAX_SCROLLBACK_ROWS);
		this._cursorX = Math.min(this._cursorX, cols - 1);
		this._cursorY = Math.min(this._cursorY, this._buffer.length - 1);
		this._ensureCursorInView();
	}

	public write(data: string): void {
		for (const char of data) {
			this._consume(char);
		}
	}

	public getLine(rowIndex: number): ITerminalCell[] {
		const line = this._buffer[rowIndex];
		if (!line) {
			return [];
		}
		return line;
	}

	public getVisibleLines(): ITerminalCell[][] {
		const start = Math.max(0, this._buffer.length - this._rows);
		return this._buffer.slice(start);
	}

	public clear(): void {
		this._initBuffer();
	}

	private _ensureLine(y: number): ITerminalCell[] {
		while (this._buffer.length <= y) {
			this._buffer.push([]);
		}
		return this._buffer[y];
	}

	private _ensureCursorInView(): void {
		const bottom = this._buffer.length - 1;
		if (this._cursorY > bottom) {
			this._cursorY = bottom;
		}
	}

	private _scrollUp(): void {
		if (this._buffer.length >= this._rows + MAX_SCROLLBACK_ROWS) {
			this._buffer.shift();
		}
		this._buffer.push([]);
		this._ensureCursorInView();
	}

	private _getCell(x: number, y: number): ITerminalCell {
		const line = this._ensureLine(y);
		while (line.length <= x) {
			line.push(createEmptyCell(this._fg, this._bg, this._bold));
		}
		return line[x];
	}

	private _setCell(x: number, y: number, ch: string): void {
		const line = this._ensureLine(y);
		while (line.length < x) {
			line.push(createEmptyCell(this._fg, this._bg, this._bold));
		}
		line[x] = { ch, fg: this._fg, bg: this._bg, bold: this._bold };
	}

	private _putChar(ch: string): void {
		if (this._cursorX >= this._cols) {
			this._cursorX = 0;
			this._cursorY++;
		}
		if (this._cursorY >= this._buffer.length) {
			this._scrollUp();
		}
		this._setCell(this._cursorX, this._cursorY, ch);
		this._cursorX++;
	}

	private _consume(char: string): void {
		const code = char.charCodeAt(0);
		switch (this._escapeState) {
			case 'normal': {
				if (char === '\x1b') {
					this._escapeState = 'escape';
					return;
				}
				if (char === '\r') {
					this._cursorX = 0;
					return;
				}
				if (char === '\n' || char === '\x0b' || char === '\x0c') {
					this._cursorX = 0;
					this._cursorY++;
					if (this._cursorY >= this._buffer.length) {
						this._scrollUp();
					}
					return;
				}
				if (char === '\b') {
					this._cursorX = Math.max(0, this._cursorX - 1);
					return;
				}
				if (char === '\t') {
					const next = Math.ceil((this._cursorX + 1) / 8) * 8;
					this._cursorX = Math.min(this._cols - 1, next);
					return;
				}
				if (char === '\x07') {
					this._onBell.fire();
					return;
				}
				if (code >= 0x20 || code === 0x00) {
					this._putChar(char);
				}
				return;
			}
			case 'escape': {
				if (char === '[') {
					this._escapeState = 'csi';
					this._csiParams = [];
					this._csiIntermediate = '';
				} else if (char === ']') {
					this._escapeState = 'osc';
					this._oscBuffer = '';
				} else if (char === '7') {
					this._saveCursor();
					this._escapeState = 'normal';
				} else if (char === '8') {
					this._restoreCursor();
					this._escapeState = 'normal';
				} else if (char === 'c') {
					this._initBuffer();
					this._resetAttributes();
					this._escapeState = 'normal';
				} else {
					this._escapeState = 'normal';
				}
				return;
			}
			case 'csi': {
				if (char === '?') {
					this._csiIntermediate += '?';
					return;
				}
				if (code >= 0x30 && code <= 0x3f && char !== ' ' && !this._csiIntermediate.endsWith('?')) {
					this._csiParams.push(code - 0x30);
					return;
				}
				if (char >= '0' && char <= '9') {
					const last = this._csiParams.length > 0 ? this._csiParams[this._csiParams.length - 1] : -1;
					if (last >= 0) {
						this._csiParams[this._csiParams.length - 1] = last * 10 + char.charCodeAt(0) - 48;
					} else {
						this._csiParams.push(char.charCodeAt(0) - 48);
					}
					return;
				}
				if (char === ';') {
					this._csiParams.push(0);
					return;
				}
				if (char === ' ') {
					this._csiIntermediate += ' ';
					return;
				}
				if (code >= 0x40 && code <= 0x7e) {
					this._executeCsi(char);
					this._escapeState = 'normal';
				} else {
					this._escapeState = 'normal';
				}
				return;
			}
			case 'osc': {
				if (char === '\x07' || (char === '\x1b')) {
					if (char === '\x1b') {
						this._escapeState = 'escape';
						return;
					}
					this._handleOsc(this._oscBuffer);
					this._escapeState = 'normal';
					return;
				}
				this._oscBuffer += char;
				return;
			}
		}
	}

	private _param(index: number, defaultValue: number): number {
		const value = this._csiParams[index];
		if (value === undefined || value === 0) {
			return defaultValue;
		}
		return value;
	}

	private _executeCsi(finalChar: string): void {
		const params = this._csiParams;
		const get = (i: number, def: number): number => this._param(i, def);
		switch (finalChar) {
			case 'A':
				this._cursorY = Math.max(0, this._cursorY - get(0, 1));
				break;
			case 'B':
				this._cursorY = Math.min(this._buffer.length - 1, this._cursorY + get(0, 1));
				break;
			case 'C':
				this._cursorX = Math.min(this._cols - 1, this._cursorX + get(0, 1));
				break;
			case 'D':
				this._cursorX = Math.max(0, this._cursorX - get(0, 1));
				break;
			case 'E':
				this._cursorX = 0;
				this._cursorY = Math.min(this._buffer.length - 1, this._cursorY + get(0, 1));
				break;
			case 'F':
				this._cursorX = 0;
				this._cursorY = Math.max(0, this._cursorY - get(0, 1));
				break;
			case 'G':
				this._cursorX = Math.min(this._cols - 1, Math.max(0, get(0, 1) - 1));
				break;
			case 'd':
				this._cursorY = Math.max(0, get(0, 1) - 1);
				break;
			case 'H':
			case 'f':
				this._cursorX = Math.min(this._cols - 1, Math.max(0, get(1, 1) - 1));
				this._cursorY = Math.max(0, get(0, 1) - 1);
				break;
			case 'J':
				this._clearScreen(get(0, 0));
				break;
			case 'K':
				this._clearLine(get(0, 0));
				break;
			case 'm':
				this._applySgr(params.length === 0 ? [0] : params);
				break;
			case 'h':
			case 'l':
				if (this._csiIntermediate.startsWith('?')) {
					if (get(0, 0) === 25) {
						this._cursorVisible = finalChar === 'h';
					}
				}
				break;
			case 'n':
				// Device status report - diabaikan (mengirim balasan butuh stdin)
				break;
			default:
				break;
		}
	}

	private _clearScreen(mode: number): void {
		if (mode === 2 || mode === 3) {
			this._buffer = this._buffer.slice(-1);
			this._cursorX = 0;
			this._cursorY = 0;
			return;
		}
		if (mode === 1) {
			for (let y = 0; y <= this._cursorY; y++) {
				this._clearLineAt(y, 2);
			}
			return;
		}
		for (let y = this._cursorY; y < this._buffer.length; y++) {
			this._clearLineAt(y, 2);
		}
	}

	private _clearLine(mode: number): void {
		this._clearLineAt(this._cursorY, mode);
	}

	private _clearLineAt(y: number, mode: number): void {
		const line = this._ensureLine(y);
		if (mode === 2) {
			line.splice(0, line.length);
			for (let x = 0; x < this._cols; x++) {
				line.push(createEmptyCell(this._fg, this._bg, this._bold));
			}
			return;
		}
		if (mode === 1) {
			for (let x = 0; x <= this._cursorX; x++) {
				line[x] = createEmptyCell(this._fg, this._bg, this._bold);
			}
			return;
		}
		for (let x = this._cursorX; x < this._cols; x++) {
			if (line[x]) {
				line[x] = createEmptyCell(this._fg, this._bg, this._bold);
			}
		}
	}

	private _applySgr(params: number[]): void {
		let i = 0;
		while (i < params.length) {
			const p = params[i];
			if (p === 0) {
				this._resetAttributes();
			} else if (p === 1) {
				this._bold = true;
			} else if (p === 22) {
				this._bold = false;
			} else if (p >= 30 && p <= 37) {
				this._fg = p - 30;
			} else if (p === 39) {
				this._fg = 7;
			} else if (p >= 40 && p <= 47) {
				this._bg = p - 40;
			} else if (p === 49) {
				this._bg = 0;
			} else if (p >= 90 && p <= 97) {
				this._fg = p - 90 + 8;
			} else if (p >= 100 && p <= 107) {
				this._bg = p - 100 + 8;
			} else if (p === 38 || p === 48) {
				if (params[i + 1] === 5) {
					const color = params[i + 2];
					if (p === 38) {
						this._fg = color;
					} else {
						this._bg = color;
					}
					i += 2;
				} else if (params[i + 1] === 2) {
					const r = params[i + 2];
					const g = params[i + 3];
					const b = params[i + 4];
					const index = this._registerTrueColor(r, g, b);
					if (p === 38) {
						this._fg = index;
					} else {
						this._bg = index;
					}
					i += 4;
				}
			}
			i++;
		}
	}

	private _trueColorCache = new Map<string, number>();
	private _nextCustomColorIndex = 256;

	private _registerTrueColor(r: number, g: number, b: number): number {
		const key = `${r},${g},${b}`;
		const cached = this._trueColorCache.get(key);
		if (cached !== undefined) {
			return cached;
		}
		const index = this._nextCustomColorIndex++;
		this._trueColorCache.set(key, index);
		TERMINAL_PALETTE[index] = `rgb(${r},${g},${b})`;
		return index;
	}

	private _resetAttributes(): void {
		this._fg = 7;
		this._bg = 0;
		this._bold = false;
	}

	private _savedCursor: { x: number; y: number } = { x: 0, y: 0 };

	private _saveCursor(): void {
		this._savedCursor = { x: this._cursorX, y: this._cursorY };
	}

	private _restoreCursor(): void {
		this._cursorX = Math.min(this._savedCursor.x, this._cols - 1);
		this._cursorY = this._savedCursor.y;
	}

	private _handleOsc(buffer: string): void {
		const parts = buffer.split(';');
		if (parts.length >= 2 && (parts[0] === '0' || parts[0] === '2')) {
			this._onTitleChange.fire(parts.slice(1).join(';'));
		}
	}
}

export class XtermRenderer extends Disposable {
	private readonly _canvas: HTMLCanvasElement;
	private readonly _ctx: CanvasRenderingContext2D;
	private readonly _emulator: TerminalEmulator;
	private readonly _container: HTMLElement;
	private _cellWidth = 8;
	private _cellHeight = 16;
	private _fontFamily = '"Cascadia Mono", Consolas, "Courier New", monospace';
	private _fontSize = 13;
	private _blinkTimer: any = undefined;
	private _cursorOn = true;
	private _resizeObserver: ResizeObserver | undefined;

	constructor(container: HTMLElement, emulator: TerminalEmulator) {
		super();
		this._container = container;
		this._emulator = emulator;
		this._canvas = document.createElement('canvas');
		this._canvas.style.cssText = 'width:100%;height:100%;display:block;';
		container.appendChild(this._canvas);
		this._ctx = this._canvas.getContext('2d')!;
		this._measureCell();
		this._fitToContainer();
		this._register({ dispose: () => this._blinkTimer && clearInterval(this._blinkTimer) });
		if (typeof ResizeObserver !== 'undefined') {
			this._resizeObserver = new ResizeObserver(() => this._fitToContainer());
			this._resizeObserver.observe(container);
		}
		this._render();
	}

	public render(): void {
		this._render();
	}

	private _measureCell(): void {
		this._ctx.font = `${this._fontSize}px ${this._fontFamily}`;
		const metrics = this._ctx.measureText('W');
		this._cellWidth = Math.ceil(metrics.width);
		this._cellHeight = Math.ceil(this._fontSize * 1.35);
	}

	private _fitToContainer(): void {
		const width = this._container.clientWidth || 600;
		const height = this._container.clientHeight || 200;
		const dpr = window.devicePixelRatio || 1;
		this._canvas.width = Math.max(1, Math.floor(width * dpr));
		this._canvas.height = Math.max(1, Math.floor(height * dpr));
		this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		this._measureCell();
		const cols = Math.max(2, Math.floor(width / this._cellWidth));
		const rows = Math.max(1, Math.floor(height / this._cellHeight));
		this._emulator.resize(cols, rows);
		this._render();
	}

	private _render(): void {
		const width = this._container.clientWidth || 600;
		const height = this._container.clientHeight || 200;
		if (this._canvas.width === 0 || this._canvas.height === 0) {
			return;
		}
		this._ctx.fillStyle = TERMINAL_DEFAULT_BG;
		this._ctx.fillRect(0, 0, width, height);
		this._ctx.font = `${this._fontSize}px ${this._fontFamily}`;
		this._ctx.textBaseline = 'top';

		const rows = this._emulator.rows;
		const cols = this._emulator.cols;
		const lines = this._emulator.getVisibleLines();
		const lineOffset = this._emulator.totalRows - lines.length;

		for (let r = 0; r < rows; r++) {
			const line = lines[r] ?? [];
			const absoluteRow = lineOffset + r;
			for (let c = 0; c < cols; c++) {
				const cell = line[c];
				if (!cell) {
					continue;
				}
				const isCursor = this._cursorOn && this._emulator.cursorVisible && r === this._emulator.cursorY && c === this._emulator.cursorX;
				const x = c * this._cellWidth;
				const y = r * this._cellHeight;
				const bgColor = this._emulator.getVisibleLines()[r] ? TERMINAL_PALETTE[cell.bg] ?? TERMINAL_DEFAULT_BG : TERMINAL_DEFAULT_BG;
				if (cell.bg !== 0 || isCursor) {
					this._ctx.fillStyle = isCursor ? '#f2f2f2' : (TERMINAL_PALETTE[cell.bg] ?? TERMINAL_DEFAULT_BG);
					this._ctx.fillRect(x, y, this._cellWidth, this._cellHeight);
				}
				if (cell.ch !== ' ') {
					this._ctx.fillStyle = isCursor ? '#000000' : (TERMINAL_PALETTE[cell.fg] ?? TERMINAL_DEFAULT_FG);
					this._ctx.font = `${cell.bold ? 'bold ' : ''}${this._fontSize}px ${this._fontFamily}`;
					this._ctx.fillText(cell.ch, x, y);
				}
			}
		}
	}

	public startBlink(interval = 530): void {
		this._blinkTimer = setInterval(() => {
			this._cursorOn = !this._cursorOn;
			this._render();
		}, interval);
	}

	public focus(): void {
		this._container.focus();
	}
}

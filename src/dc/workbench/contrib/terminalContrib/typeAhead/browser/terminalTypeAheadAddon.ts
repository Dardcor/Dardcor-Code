/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from '../../../../../base/common/async.js';
import { Color, RGBA } from '../../../../../base/common/color.js';
import { debounce } from '../../../../../base/common/decorators.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { escapeRegExpCharacters } from '../../../../../base/common/strings.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { XtermAttributes, IXtermCore } from '../../../terminal/browser/xterm-private.js';
import { IBeforeProcessDataEvent, ITerminalProcessManager, TERMINAL_CONFIG_SECTION } from '../../../terminal/common/terminal.js';
import type { IBuffer, IBufferCell, IDisposable, ITerminalAddon, Terminal } from '@xterm/xterm';
import { DEFAULT_LOCAL_ECHO_EXCLUDE, type ITerminalTypeAheadConfiguration } from '../common/terminalTypeAheadConfiguration.js';
import { isNumber, type SingleOrMany } from '../../../../../base/common/types.js';

const enum VT {
	Esc = '\x1b',
	Csi = `\x1b[`,
	ShowCursor = `\x1b[?25h`,
	HideCursor = `\x1b[?25l`,
	DeleteChar = `\x1b[X`,
	DeleteRestOfLine = `\x1b[K`,
}

const CSI_STYLE_RE = /^\x1b\[[0-9;]*m/;
const CSI_MOVE_RE = /^\x1b\[?([0-9]*)(;[35])?O?([DC])/;
const NOT_WORD_RE = /[^a-z0-9]/i;

const enum StatsConstants {
	StatsBufferSize = 24,
	StatsSendTelemetryEvery = 1000 * 60 * 5,
	StatsMinSamplesToTurnOn = 5,
	StatsMinAccuracyToTurnOn = 0.3,
	StatsToggleOffThreshold = 0.5,
}

const PREDICTION_OMIT_RE = /^(\x1b\[(\??25[hl]|\??[0-9;]+n))+/;

const core = (terminal: Terminal): IXtermCore => {
	interface XtermWithCore extends Terminal {
		_core: IXtermCore;
	}
	return (terminal as XtermWithCore)._core;
};
const flushOutput = (terminal: Terminal) => {
};

const enum CursorMoveDirection {
	Back = 'D',
	Forwards = 'C',
}

interface ICoordinate {
	x: number;
	y: number;
	baseY: number;
}

class Cursor implements ICoordinate {
	private _x = 0;
	private _y = 1;
	private _baseY = 1;

	get x() {
		return this._x;
	}

	get y() {
		return this._y;
	}

	get baseY() {
		return this._baseY;
	}

	get coordinate(): ICoordinate {
		return { x: this._x, y: this._y, baseY: this._baseY };
	}

	constructor(
		readonly rows: number,
		readonly cols: number,
		private readonly _buffer: IBuffer
	) {
		this._x = _buffer.cursorX;
		this._y = _buffer.cursorY;
		this._baseY = _buffer.baseY;
	}

	getLine() {
		return this._buffer.getLine(this._y + this._baseY);
	}

	getCell(loadInto?: IBufferCell) {
		return this.getLine()?.getCell(this._x, loadInto);
	}

	moveTo(coordinate: ICoordinate) {
		this._x = coordinate.x;
		this._y = (coordinate.y + coordinate.baseY) - this._baseY;
		return this.moveInstruction();
	}

	clone() {
		const c = new Cursor(this.rows, this.cols, this._buffer);
		c.moveTo(this);
		return c;
	}

	move(x: number, y: number) {
		this._x = x;
		this._y = y;
		return this.moveInstruction();
	}

	shift(x: number = 0, y: number = 0) {
		this._x += x;
		this._y += y;
		return this.moveInstruction();
	}

	moveInstruction() {
		if (this._y >= this.rows) {
			this._baseY += this._y - (this.rows - 1);
			this._y = this.rows - 1;
		} else if (this._y < 0) {
			this._baseY -= this._y;
			this._y = 0;
		}

		return `${VT.Csi}${this._y + 1};${this._x + 1}H`;
	}
}

const moveToWordBoundary = (b: IBuffer, cursor: Cursor, direction: -1 | 1) => {
	let ateLeadingWhitespace = false;
	if (direction < 0) {
		cursor.shift(-1);
	}

	let cell: IBufferCell | undefined;
	while (cursor.x >= 0) {
		cell = cursor.getCell(cell);
		if (!cell?.getCode()) {
			return;
		}

		const chars = cell.getChars();
		if (NOT_WORD_RE.test(chars)) {
			if (ateLeadingWhitespace) {
				break;
			}
		} else {
			ateLeadingWhitespace = true;
		}

		cursor.shift(direction);
	}

	if (direction < 0) {
		cursor.shift(1);
	}
};

const enum MatchResult {
	Success,
	Failure,
	Buffer,
}

export interface IPrediction {
	readonly affectsStyle?: boolean;

	readonly clearAfterTimeout?: boolean;

	apply(buffer: IBuffer, cursor: Cursor): string;

	rollback(cursor: Cursor): string;

	rollForwards(cursor: Cursor, withInput: string): string;

	matches(input: StringReader, lookBehind?: IPrediction): MatchResult;
}

class StringReader {
	index = 0;

	get remaining() {
		return this._input.length - this.index;
	}

	get eof() {
		return this.index === this._input.length;
	}

	get rest() {
		return this._input.slice(this.index);
	}

	constructor(
		private readonly _input: string
	) { }

	eatChar(char: string) {
		if (this._input[this.index] !== char) {
			return;
		}

		this.index++;
		return char;
	}

	eatStr(substr: string) {
		if (this._input.slice(this.index, substr.length) !== substr) {
			return;
		}

		this.index += substr.length;
		return substr;
	}

	eatGradually(substr: string): MatchResult {
		const prevIndex = this.index;
		for (let i = 0; i < substr.length; i++) {
			if (i > 0 && this.eof) {
				return MatchResult.Buffer;
			}

			if (!this.eatChar(substr[i])) {
				this.index = prevIndex;
				return MatchResult.Failure;
			}
		}

		return MatchResult.Success;
	}

	eatRe(re: RegExp) {
		const match = re.exec(this._input.slice(this.index));
		if (!match) {
			return;
		}

		this.index += match[0].length;
		return match;
	}

	eatCharCode(min = 0, max = min + 1) {
		const code = this._input.charCodeAt(this.index);
		if (code < min || code >= max) {
			return undefined;
		}

		this.index++;
		return code;
	}
}

class HardBoundary implements IPrediction {
	readonly clearAfterTimeout = false;

	apply() {
		return '';
	}

	rollback() {
		return '';
	}

	rollForwards() {
		return '';
	}

	matches() {
		return MatchResult.Failure;
	}
}

class TentativeBoundary implements IPrediction {
	private _appliedCursor?: Cursor;

	constructor(readonly inner: IPrediction) { }

	apply(buffer: IBuffer, cursor: Cursor) {
		this._appliedCursor = cursor.clone();
		this.inner.apply(buffer, this._appliedCursor);
		return '';
	}

	rollback(cursor: Cursor) {
		this.inner.rollback(cursor.clone());
		return '';
	}

	rollForwards(cursor: Cursor, withInput: string) {
		if (this._appliedCursor) {
			cursor.moveTo(this._appliedCursor);
		}

		return withInput;
	}

	matches(input: StringReader) {
		return this.inner.matches(input);
	}
}

const isTenativeCharacterPrediction = (p: unknown): p is (TentativeBoundary & { inner: CharacterPrediction }) =>
	p instanceof TentativeBoundary && p.inner instanceof CharacterPrediction;

class CharacterPrediction implements IPrediction {
	readonly affectsStyle = true;

	appliedAt?: {
		pos: ICoordinate;
		oldAttributes: string;
		oldChar: string;
	};

	constructor(private readonly _style: TypeAheadStyle, private readonly _char: string) { }

	apply(_: IBuffer, cursor: Cursor) {
		const cell = cursor.getCell();
		this.appliedAt = cell
			? { pos: cursor.coordinate, oldAttributes: attributesToSeq(cell), oldChar: cell.getChars() }
			: { pos: cursor.coordinate, oldAttributes: '', oldChar: '' };

		cursor.shift(1);

		return this._style.apply + this._char + this._style.undo;
	}

	rollback(cursor: Cursor) {
		if (!this.appliedAt) {
			return '';
		}

		const { oldAttributes, oldChar, pos } = this.appliedAt;
		const r = cursor.moveTo(pos) + (oldChar ? `${oldAttributes}${oldChar}${cursor.moveTo(pos)}` : VT.DeleteChar);
		return r;
	}

	rollForwards(cursor: Cursor, input: string) {
		if (!this.appliedAt) {
			return '';
		}

		return cursor.clone().moveTo(this.appliedAt.pos) + input;
	}

	matches(input: StringReader, lookBehind?: IPrediction) {
		const startIndex = input.index;

		while (input.eatRe(CSI_STYLE_RE)) { }

		if (input.eof) {
			return MatchResult.Buffer;
		}

		if (input.eatChar(this._char)) {
			return MatchResult.Success;
		}

		if (lookBehind instanceof CharacterPrediction) {
			const sillyZshOutcome = input.eatGradually(`\b${lookBehind._char}${this._char}`);
			if (sillyZshOutcome !== MatchResult.Failure) {
				return sillyZshOutcome;
			}
		}

		input.index = startIndex;
		return MatchResult.Failure;
	}
}

class BackspacePrediction implements IPrediction {
	protected _appliedAt?: {
		pos: ICoordinate;
		oldAttributes: string;
		oldChar: string;
		isLastChar: boolean;
	};

	constructor(private readonly _terminal: Terminal) { }

	apply(_: IBuffer, cursor: Cursor) {
		const isLastChar = !cursor.getLine()?.translateToString(undefined, cursor.x).trim();
		const pos = cursor.coordinate;
		const move = cursor.shift(-1);
		const cell = cursor.getCell();
		this._appliedAt = cell
			? { isLastChar, pos, oldAttributes: attributesToSeq(cell), oldChar: cell.getChars() }
			: { isLastChar, pos, oldAttributes: '', oldChar: '' };

		return move + VT.DeleteChar;
	}

	rollback(cursor: Cursor) {
		if (!this._appliedAt) {
			return '';
		}

		const { oldAttributes, oldChar, pos } = this._appliedAt;
		if (!oldChar) {
			return cursor.moveTo(pos) + VT.DeleteChar;
		}

		return oldAttributes + oldChar + cursor.moveTo(pos) + attributesToSeq(core(this._terminal)._inputHandler._curAttrData);
	}

	rollForwards() {
		return '';
	}

	matches(input: StringReader) {
		if (this._appliedAt?.isLastChar) {
			const r1 = input.eatGradually(`\b${VT.Csi}K`);
			if (r1 !== MatchResult.Failure) {
				return r1;
			}

			const r2 = input.eatGradually(`\b \b`);
			if (r2 !== MatchResult.Failure) {
				return r2;
			}
		}

		return MatchResult.Failure;
	}
}

class NewlinePrediction implements IPrediction {
	protected _prevPosition?: ICoordinate;

	apply(_: IBuffer, cursor: Cursor) {
		this._prevPosition = cursor.coordinate;
		cursor.move(0, cursor.y + 1);
		return '\r\n';
	}

	rollback(cursor: Cursor) {
		return this._prevPosition ? cursor.moveTo(this._prevPosition) : '';
	}

	rollForwards() {
		return '';
	}

	matches(input: StringReader) {
		return input.eatGradually('\r\n');
	}
}

class LinewrapPrediction extends NewlinePrediction implements IPrediction {
	override apply(_: IBuffer, cursor: Cursor) {
		this._prevPosition = cursor.coordinate;
		cursor.move(0, cursor.y + 1);
		return ' \r';
	}

	override matches(input: StringReader) {
		const r = input.eatGradually(' \r');
		if (r !== MatchResult.Failure) {
			const r2 = input.eatGradually(VT.DeleteRestOfLine);
			return r2 === MatchResult.Buffer ? MatchResult.Buffer : r;
		}

		return input.eatGradually('\r\n');
	}
}

class CursorMovePrediction implements IPrediction {
	private _applied?: {
		rollForward: string;
		prevPosition: number;
		prevAttrs: string;
		amount: number;
	};

	constructor(
		private readonly _direction: CursorMoveDirection,
		private readonly _moveByWords: boolean,
		private readonly _amount: number,
	) { }

	apply(buffer: IBuffer, cursor: Cursor) {
		const prevPosition = cursor.x;
		const currentCell = cursor.getCell();
		const prevAttrs = currentCell ? attributesToSeq(currentCell) : '';

		const { _amount: amount, _direction: direction, _moveByWords: moveByWords } = this;
		const delta = direction === CursorMoveDirection.Back ? -1 : 1;

		const target = cursor.clone();
		if (moveByWords) {
			for (let i = 0; i < amount; i++) {
				moveToWordBoundary(buffer, target, delta);
			}
		} else {
			target.shift(delta * amount);
		}

		this._applied = {
			amount: Math.abs(cursor.x - target.x),
			prevPosition,
			prevAttrs,
			rollForward: cursor.moveTo(target),
		};

		return this._applied.rollForward;
	}

	rollback(cursor: Cursor) {
		if (!this._applied) {
			return '';
		}

		return cursor.move(this._applied.prevPosition, cursor.y) + this._applied.prevAttrs;
	}

	rollForwards() {
		return '';
	}

	matches(input: StringReader) {
		if (!this._applied) {
			return MatchResult.Failure;
		}

		const direction = this._direction;
		const { amount, rollForward } = this._applied;


		if (input.eatStr(`${VT.Csi}${direction}`.repeat(amount))) {
			return MatchResult.Success;
		}

		if (direction === CursorMoveDirection.Back) {
			if (input.eatStr(`\b`.repeat(amount))) {
				return MatchResult.Success;
			}
		}

		if (rollForward) {
			const r = input.eatGradually(rollForward);
			if (r !== MatchResult.Failure) {
				return r;
			}
		}

		return input.eatGradually(`${VT.Csi}${amount}${direction}`);
	}
}

export class PredictionStats extends Disposable {
	private readonly _stats: [latency: number, correct: boolean][] = [];
	private _index = 0;
	private readonly _addedAtTime = new WeakMap<IPrediction, number>();
	private readonly _changeEmitter = this._register(new Emitter<void>());
	readonly onChange = this._changeEmitter.event;

	get accuracy() {
		let correctCount = 0;
		for (const [, correct] of this._stats) {
			if (correct) {
				correctCount++;
			}
		}

		return correctCount / (this._stats.length || 1);
	}

	get sampleSize() {
		return this._stats.length;
	}

	get latency() {
		const latencies = this._stats.filter(([, correct]) => correct).map(([s]) => s).sort();

		return {
			count: latencies.length,
			min: latencies[0],
			median: latencies[Math.floor(latencies.length / 2)],
			max: latencies[latencies.length - 1],
		};
	}

	get maxLatency() {
		let max = -Infinity;
		for (const [latency, correct] of this._stats) {
			if (correct) {
				max = Math.max(latency, max);
			}
		}

		return max;
	}

	constructor(timeline: PredictionTimeline) {
		super();
		this._register(timeline.onPredictionAdded(p => this._addedAtTime.set(p, Date.now())));
		this._register(timeline.onPredictionSucceeded(this._pushStat.bind(this, true)));
		this._register(timeline.onPredictionFailed(this._pushStat.bind(this, false)));
	}

	private _pushStat(correct: boolean, prediction: IPrediction) {
		const started = this._addedAtTime.get(prediction)!;
		this._stats[this._index] = [Date.now() - started, correct];
		this._index = (this._index + 1) % StatsConstants.StatsBufferSize;
		this._changeEmitter.fire();
	}
}

export class PredictionTimeline extends Disposable {
	private _expected: ({ gen: number; p: IPrediction })[] = [];

	private _currentGen = 0;

	private _physicalCursor: Cursor | undefined;

	private _tenativeCursor: Cursor | undefined;

	private _inputBuffer?: string;

	private _showPredictions = false;

	private _lookBehind?: IPrediction;

	private readonly _addedEmitter = this._register(new Emitter<IPrediction>());
	readonly onPredictionAdded = this._addedEmitter.event;
	private readonly _failedEmitter = this._register(new Emitter<IPrediction>());
	readonly onPredictionFailed = this._failedEmitter.event;
	private readonly _succeededEmitter = this._register(new Emitter<IPrediction>());
	readonly onPredictionSucceeded = this._succeededEmitter.event;

	private get _currentGenerationPredictions() {
		return this._expected.filter(({ gen }) => gen === this._expected[0].gen).map(({ p }) => p);
	}

	get isShowingPredictions() {
		return this._showPredictions;
	}

	get length() {
		return this._expected.length;
	}

	constructor(readonly terminal: Terminal, private readonly _style: TypeAheadStyle) { super(); }

	setShowPredictions(show: boolean) {
		if (show === this._showPredictions) {
			return;
		}

		this._showPredictions = show;

		const buffer = this._getActiveBuffer();
		if (!buffer) {
			return;
		}

		const toApply = this._currentGenerationPredictions;
		if (show) {
			this.clearCursor();
			this._style.expectIncomingStyle(toApply.reduce((count, p) => p.affectsStyle ? count + 1 : count, 0));
			this.terminal.write(toApply.map(p => p.apply(buffer, this.physicalCursor(buffer))).join(''));
		} else {
			this.terminal.write(toApply.reverse().map(p => p.rollback(this.physicalCursor(buffer))).join(''));
		}
	}

	undoAllPredictions() {
		const buffer = this._getActiveBuffer();
		if (this._showPredictions && buffer) {
			this.terminal.write(this._currentGenerationPredictions.reverse()
				.map(p => p.rollback(this.physicalCursor(buffer))).join(''));
		}

		this._expected = [];
	}

	beforeServerInput(input: string): string {
		const originalInput = input;
		if (this._inputBuffer) {
			input = this._inputBuffer + input;
			this._inputBuffer = undefined;
		}

		if (!this._expected.length) {
			this._clearPredictionState();
			return input;
		}

		const buffer = this._getActiveBuffer();
		if (!buffer) {
			this._clearPredictionState();
			return input;
		}

		let output = '';

		const reader = new StringReader(input);
		const startingGen = this._expected[0].gen;
		const emitPredictionOmitted = () => {
			const omit = reader.eatRe(PREDICTION_OMIT_RE);
			if (omit) {
				output += omit[0];
			}
		};

		ReadLoop: while (this._expected.length && reader.remaining > 0) {
			emitPredictionOmitted();

			const { p: prediction, gen } = this._expected[0];
			const cursor = this.physicalCursor(buffer);
			const beforeTestReaderIndex = reader.index;
			switch (prediction.matches(reader, this._lookBehind)) {
				case MatchResult.Success: {
					const eaten = input.slice(beforeTestReaderIndex, reader.index);
					if (gen === startingGen) {
						output += prediction.rollForwards?.(cursor, eaten);
					} else {
						prediction.apply(buffer, this.physicalCursor(buffer));
						output += eaten;
					}

					this._succeededEmitter.fire(prediction);
					this._lookBehind = prediction;
					this._expected.shift();
					break;
				}
				case MatchResult.Buffer:
					this._inputBuffer = input.slice(beforeTestReaderIndex);
					reader.index = input.length;
					break ReadLoop;
				case MatchResult.Failure: {
					const rollback = this._expected.filter(p => p.gen === startingGen).reverse();
					output += rollback.map(({ p }) => p.rollback(this.physicalCursor(buffer))).join('');
					if (rollback.some(r => r.p.affectsStyle)) {
						output += attributesToSeq(core(this.terminal)._inputHandler._curAttrData);
					}
					this._clearPredictionState();
					this._failedEmitter.fire(prediction);
					break ReadLoop;
				}
			}
		}

		emitPredictionOmitted();

		if (!reader.eof) {
			output += reader.rest;
			this._clearPredictionState();
		}

		if (this._expected.length && startingGen !== this._expected[0].gen) {
			for (const { p, gen } of this._expected) {
				if (gen !== this._expected[0].gen) {
					break;
				}
				if (p.affectsStyle) {
					this._style.expectIncomingStyle();
				}

				output += p.apply(buffer, this.physicalCursor(buffer));
			}
		}

		if (!this._showPredictions) {
			return originalInput;
		}

		if (output.length === 0 || output === input) {
			return output;
		}

		if (this._physicalCursor) {
			output += this._physicalCursor.moveInstruction();
		}

		output = VT.HideCursor + output + VT.ShowCursor;

		return output;
	}

	private _clearPredictionState() {
		this._expected = [];
		this.clearCursor();
		this._lookBehind = undefined;
	}

	addPrediction(buffer: IBuffer, prediction: IPrediction) {
		this._expected.push({ gen: this._currentGen, p: prediction });
		this._addedEmitter.fire(prediction);

		if (this._currentGen !== this._expected[0].gen) {
			prediction.apply(buffer, this.tentativeCursor(buffer));
			return false;
		}

		const text = prediction.apply(buffer, this.physicalCursor(buffer));
		this._tenativeCursor = undefined;

		if (this._showPredictions && text) {
			if (prediction.affectsStyle) {
				this._style.expectIncomingStyle();
			}
			this.terminal.write(text);
		}

		return true;
	}

	addBoundary(): void;
	addBoundary(buffer: IBuffer, prediction: IPrediction): boolean;
	addBoundary(buffer?: IBuffer, prediction?: IPrediction) {
		let applied = false;
		if (buffer && prediction) {
			applied = this.addPrediction(buffer, new TentativeBoundary(prediction));
			prediction.apply(buffer, this.tentativeCursor(buffer));
		}
		this._currentGen++;
		return applied;
	}

	peekEnd(): IPrediction | undefined {
		return this._expected[this._expected.length - 1]?.p;
	}

	peekStart(): IPrediction | undefined {
		return this._expected[0]?.p;
	}

	physicalCursor(buffer: IBuffer) {
		if (!this._physicalCursor) {
			if (this._showPredictions) {
				flushOutput(this.terminal);
			}
			this._physicalCursor = new Cursor(this.terminal.rows, this.terminal.cols, buffer);
		}

		return this._physicalCursor;
	}

	tentativeCursor(buffer: IBuffer) {
		if (!this._tenativeCursor) {
			this._tenativeCursor = this.physicalCursor(buffer).clone();
		}

		return this._tenativeCursor;
	}

	clearCursor() {
		this._physicalCursor = undefined;
		this._tenativeCursor = undefined;
	}

	private _getActiveBuffer() {
		const buffer = this.terminal.buffer.active;
		return buffer.type === 'normal' ? buffer : undefined;
	}
}

const attributesToArgs = (cell: XtermAttributes) => {
	if (cell.isAttributeDefault()) { return [0]; }

	const args = [];
	if (cell.isBold()) { args.push(1); }
	if (cell.isDim()) { args.push(2); }
	if (cell.isItalic()) { args.push(3); }
	if (cell.isUnderline()) { args.push(4); }
	if (cell.isBlink()) { args.push(5); }
	if (cell.isInverse()) { args.push(7); }
	if (cell.isInvisible()) { args.push(8); }

	if (cell.isFgRGB()) { args.push(38, 2, cell.getFgColor() >>> 24, (cell.getFgColor() >>> 16) & 0xFF, cell.getFgColor() & 0xFF); }
	if (cell.isFgPalette()) { args.push(38, 5, cell.getFgColor()); }
	if (cell.isFgDefault()) { args.push(39); }

	if (cell.isBgRGB()) { args.push(48, 2, cell.getBgColor() >>> 24, (cell.getBgColor() >>> 16) & 0xFF, cell.getBgColor() & 0xFF); }
	if (cell.isBgPalette()) { args.push(48, 5, cell.getBgColor()); }
	if (cell.isBgDefault()) { args.push(49); }

	return args;
};

const attributesToSeq = (cell: XtermAttributes) => `${VT.Csi}${attributesToArgs(cell).join(';')}m`;

const arrayHasPrefixAt = <T>(a: ReadonlyArray<T>, ai: number, b: ReadonlyArray<T>) => {
	if (a.length - ai > b.length) {
		return false;
	}

	for (let bi = 0; bi < b.length; bi++, ai++) {
		if (b[ai] !== a[ai]) {
			return false;
		}
	}

	return true;
};

const getColorWidth = (params: SingleOrMany<number>[], pos: number) => {
	const accu = [0, 0, -1, 0, 0, 0];
	let cSpace = 0;
	let advance = 0;

	do {
		const v = params[pos + advance];
		accu[advance + cSpace] = isNumber(v) ? v : v[0];
		if (!isNumber(v)) {
			let i = 0;
			do {
				if (accu[1] === 5) {
					cSpace = 1;
				}
				accu[advance + i + 1 + cSpace] = v[i];
			} while (++i < v.length && i + advance + 1 + cSpace < accu.length);
			break;
		}
		if ((accu[1] === 5 && advance + cSpace >= 2)
			|| (accu[1] === 2 && advance + cSpace >= 5)) {
			break;
		}
		if (accu[1]) {
			cSpace = 1;
		}
	} while (++advance + pos < params.length && advance + cSpace < accu.length);

	return advance;
};

class TypeAheadStyle implements IDisposable {
	private static _compileArgs(args: ReadonlyArray<number>) {
		return `${VT.Csi}${args.join(';')}m`;
	}

	private _expectedIncomingStyles = 0;
	private _applyArgs!: ReadonlyArray<number>;
	private _originalUndoArgs!: ReadonlyArray<number>;
	private _undoArgs!: ReadonlyArray<number>;

	apply!: string;
	undo!: string;
	private _csiHandler?: IDisposable;

	constructor(value: ITerminalTypeAheadConfiguration['localEchoStyle'], private readonly _terminal: Terminal) {
		this.onUpdate(value);
	}

	expectIncomingStyle(n = 1) {
		this._expectedIncomingStyles += n * 2;
	}

	startTracking() {
		this._expectedIncomingStyles = 0;
		this._onDidWriteSGR(attributesToArgs(core(this._terminal)._inputHandler._curAttrData));
		this._csiHandler = this._terminal.parser.registerCsiHandler({ final: 'm' }, args => {
			this._onDidWriteSGR(args);
			return false;
		});
	}

	@debounce(2000)
	debounceStopTracking() {
		this._stopTracking();
	}

	dispose() {
		this._stopTracking();
	}

	private _stopTracking() {
		this._csiHandler?.dispose();
		this._csiHandler = undefined;
	}

	private _onDidWriteSGR(args: SingleOrMany<number>[]) {
		const originalUndo = this._undoArgs;
		for (let i = 0; i < args.length;) {
			const px = args[i];
			const p = isNumber(px) ? px : px[0];

			if (this._expectedIncomingStyles) {
				if (arrayHasPrefixAt(args, i, this._undoArgs)) {
					this._expectedIncomingStyles--;
					i += this._undoArgs.length;
					continue;
				}
				if (arrayHasPrefixAt(args, i, this._applyArgs)) {
					this._expectedIncomingStyles--;
					i += this._applyArgs.length;
					continue;
				}
			}

			const width = p === 38 || p === 48 || p === 58 ? getColorWidth(args, i) : 1;
			switch (this._applyArgs[0]) {
				case 1:
					if (p === 2) {
						this._undoArgs = [22, 2];
					} else if (p === 22 || p === 0) {
						this._undoArgs = [22];
					}
					break;
				case 2:
					if (p === 1) {
						this._undoArgs = [22, 1];
					} else if (p === 22 || p === 0) {
						this._undoArgs = [22];
					}
					break;
				case 38:
					if (p === 0 || p === 39 || p === 100) {
						this._undoArgs = [39];
					} else if ((p >= 30 && p <= 38) || (p >= 90 && p <= 97)) {
						this._undoArgs = args.slice(i, i + width) as number[];
					}
					break;
				default:
					if (p === this._applyArgs[0]) {
						this._undoArgs = this._applyArgs;
					} else if (p === 0) {
						this._undoArgs = this._originalUndoArgs;
					}
			}

			i += width;
		}

		if (originalUndo !== this._undoArgs) {
			this.undo = TypeAheadStyle._compileArgs(this._undoArgs);
		}
	}

	onUpdate(style: ITerminalTypeAheadConfiguration['localEchoStyle']) {
		const { applyArgs, undoArgs } = this._getArgs(style);
		this._applyArgs = applyArgs;
		this._undoArgs = this._originalUndoArgs = undoArgs;
		this.apply = TypeAheadStyle._compileArgs(this._applyArgs);
		this.undo = TypeAheadStyle._compileArgs(this._undoArgs);
	}

	private _getArgs(style: ITerminalTypeAheadConfiguration['localEchoStyle']) {
		switch (style) {
			case 'bold':
				return { applyArgs: [1], undoArgs: [22] };
			case 'dim':
				return { applyArgs: [2], undoArgs: [22] };
			case 'italic':
				return { applyArgs: [3], undoArgs: [23] };
			case 'underlined':
				return { applyArgs: [4], undoArgs: [24] };
			case 'inverted':
				return { applyArgs: [7], undoArgs: [27] };
			default: {
				let color: Color;
				try {
					color = Color.fromHex(style);
				} catch {
					color = new Color(new RGBA(255, 0, 0, 1));
				}

				const { r, g, b } = color.rgba;
				return { applyArgs: [38, 2, r, g, b], undoArgs: [39] };
			}
		}
	}
}

const compileExcludeRegexp = (programs = DEFAULT_LOCAL_ECHO_EXCLUDE) =>
	new RegExp(`\\b(${programs.map(escapeRegExpCharacters).join('|')})\\b`, 'i');

export const enum CharPredictState {
	Unknown,
	HasPendingChar,
	Validated,
}

export class TypeAheadAddon extends Disposable implements ITerminalAddon {
	private _typeaheadStyle?: TypeAheadStyle;
	private _typeaheadThreshold: number;
	private _excludeProgramRe: RegExp;
	protected _lastRow?: { y: number; startingX: number; endingX: number; charState: CharPredictState };
	protected _timeline?: PredictionTimeline;
	private _terminalTitle = '';
	stats?: PredictionStats;

	private _clearPredictionDebounce?: IDisposable;

	constructor(
		private _processManager: ITerminalProcessManager,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
	) {
		super();
		this._typeaheadThreshold = this._configurationService.getValue<ITerminalTypeAheadConfiguration>(TERMINAL_CONFIG_SECTION).localEchoLatencyThreshold;
		this._excludeProgramRe = compileExcludeRegexp(this._configurationService.getValue<ITerminalTypeAheadConfiguration>(TERMINAL_CONFIG_SECTION).localEchoExcludePrograms);
		this._register(toDisposable(() => this._clearPredictionDebounce?.dispose()));
	}

	activate(terminal: Terminal): void {
		const style = this._typeaheadStyle = this._register(new TypeAheadStyle(this._configurationService.getValue<ITerminalTypeAheadConfiguration>(TERMINAL_CONFIG_SECTION).localEchoStyle, terminal));
		const timeline = this._timeline = this._register(new PredictionTimeline(terminal, this._typeaheadStyle));
		const stats = this.stats = this._register(new PredictionStats(this._timeline));

		timeline.setShowPredictions(this._typeaheadThreshold === 0);
		this._register(terminal.onData(e => this._onUserData(e)));
		this._register(terminal.onTitleChange(title => {
			this._terminalTitle = title;
			this._reevaluatePredictorState(stats, timeline);
		}));
		this._register(terminal.onResize(() => {
			timeline.setShowPredictions(false);
			timeline.clearCursor();
			this._reevaluatePredictorState(stats, timeline);
		}));
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(TERMINAL_CONFIG_SECTION)) {
				style.onUpdate(this._configurationService.getValue<ITerminalTypeAheadConfiguration>(TERMINAL_CONFIG_SECTION).localEchoStyle);
				this._typeaheadThreshold = this._configurationService.getValue<ITerminalTypeAheadConfiguration>(TERMINAL_CONFIG_SECTION).localEchoLatencyThreshold;
				this._excludeProgramRe = compileExcludeRegexp(this._configurationService.getValue<ITerminalTypeAheadConfiguration>(TERMINAL_CONFIG_SECTION).localEchoExcludePrograms);
				this._reevaluatePredictorState(stats, timeline);
			}
		}));
		this._register(this._timeline.onPredictionSucceeded(p => {
			if (this._lastRow?.charState === CharPredictState.HasPendingChar && isTenativeCharacterPrediction(p) && p.inner.appliedAt) {
				if (p.inner.appliedAt.pos.y + p.inner.appliedAt.pos.baseY === this._lastRow.y) {
					this._lastRow.charState = CharPredictState.Validated;
				}
			}
		}));
		this._register(this._processManager.onBeforeProcessData(e => this._onBeforeProcessData(e)));

		let nextStatsSend: Timeout | undefined;
		this._register(stats.onChange(() => {
			if (!nextStatsSend) {
				nextStatsSend = setTimeout(() => {
					this._sendLatencyStats(stats);
					nextStatsSend = undefined;
				}, StatsConstants.StatsSendTelemetryEvery);
			}

			if (timeline.length === 0) {
				style.debounceStopTracking();
			}

			this._reevaluatePredictorState(stats, timeline);
		}));
	}

	reset() {
		this._lastRow = undefined;
	}

	private _deferClearingPredictions() {
		if (!this.stats || !this._timeline) {
			return;
		}

		this._clearPredictionDebounce?.dispose();
		if (this._timeline.length === 0 || this._timeline.peekStart()?.clearAfterTimeout === false) {
			this._clearPredictionDebounce = undefined;
			return;
		}

		this._clearPredictionDebounce = disposableTimeout(
			() => {
				this._timeline?.undoAllPredictions();
				if (this._lastRow?.charState === CharPredictState.HasPendingChar) {
					this._lastRow.charState = CharPredictState.Unknown;
				}
			},
			Math.max(500, this.stats.maxLatency * 3 / 2),
			this._store
		);
	}

	@debounce(100)
	protected _reevaluatePredictorState(stats: PredictionStats, timeline: PredictionTimeline) {
		this._reevaluatePredictorStateNow(stats, timeline);
	}

	protected _reevaluatePredictorStateNow(stats: PredictionStats, timeline: PredictionTimeline) {
		if (this._excludeProgramRe.test(this._terminalTitle)) {
			timeline.setShowPredictions(false);
		} else if (this._typeaheadThreshold < 0) {
			timeline.setShowPredictions(false);
		} else if (this._typeaheadThreshold === 0) {
			timeline.setShowPredictions(true);
		} else if (stats.sampleSize > StatsConstants.StatsMinSamplesToTurnOn && stats.accuracy > StatsConstants.StatsMinAccuracyToTurnOn) {
			const latency = stats.latency.median;
			if (latency >= this._typeaheadThreshold) {
				timeline.setShowPredictions(true);
			} else if (latency < this._typeaheadThreshold / StatsConstants.StatsToggleOffThreshold) {
				timeline.setShowPredictions(false);
			}
		}
	}

	private _sendLatencyStats(stats: PredictionStats) {
		this._telemetryService.publicLog('terminalLatencyStats', {
			...stats.latency,
			predictionAccuracy: stats.accuracy,
		});
	}

	private _onUserData(data: string): void {
		if (this._timeline?.terminal.buffer.active.type !== 'normal') {
			return;
		}


		const terminal = this._timeline.terminal;
		const buffer = terminal.buffer.active;

		if (buffer.cursorX === 1 && buffer.cursorY === terminal.rows - 1) {
			if (buffer.getLine(buffer.cursorY + buffer.baseY)?.getCell(0)?.getChars() === ':') {
				return;
			}
		}

		const actualY = buffer.baseY + buffer.cursorY;
		if (actualY !== this._lastRow?.y) {
			this._lastRow = { y: actualY, startingX: buffer.cursorX, endingX: buffer.cursorX, charState: CharPredictState.Unknown };
		} else {
			this._lastRow.startingX = Math.min(this._lastRow.startingX, buffer.cursorX);
			this._lastRow.endingX = Math.max(this._lastRow.endingX, this._timeline.physicalCursor(buffer).x);
		}

		const addLeftNavigating = (p: IPrediction) =>
			this._timeline!.tentativeCursor(buffer).x <= this._lastRow!.startingX
				? this._timeline!.addBoundary(buffer, p)
				: this._timeline!.addPrediction(buffer, p);

		const addRightNavigating = (p: IPrediction) =>
			this._timeline!.tentativeCursor(buffer).x >= this._lastRow!.endingX - 1
				? this._timeline!.addBoundary(buffer, p)
				: this._timeline!.addPrediction(buffer, p);

		const reader = new StringReader(data);
		while (reader.remaining > 0) {
			if (reader.eatCharCode(127)) {
				const previous = this._timeline.peekEnd();
				if (previous && previous instanceof CharacterPrediction) {
					this._timeline.addBoundary();
				}

				if (this._timeline.isShowingPredictions) {
					flushOutput(this._timeline.terminal);
				}

				if (this._timeline.tentativeCursor(buffer).x <= this._lastRow.startingX) {
					this._timeline.addBoundary(buffer, new BackspacePrediction(this._timeline.terminal));
				} else {
					this._lastRow.endingX--;
					this._timeline.addPrediction(buffer, new BackspacePrediction(this._timeline.terminal));
				}

				continue;
			}

			if (reader.eatCharCode(32, 126)) {
				const char = data[reader.index - 1];
				const prediction = new CharacterPrediction(this._typeaheadStyle!, char);
				if (this._lastRow.charState === CharPredictState.Unknown) {
					this._timeline.addBoundary(buffer, prediction);
					this._lastRow.charState = CharPredictState.HasPendingChar;
				} else {
					this._timeline.addPrediction(buffer, prediction);
				}

				if (this._timeline.tentativeCursor(buffer).x >= terminal.cols) {
					this._timeline.addBoundary(buffer, new LinewrapPrediction());
				}
				continue;
			}

			const cursorMv = reader.eatRe(CSI_MOVE_RE);
			if (cursorMv) {
				const direction = cursorMv[3] as CursorMoveDirection;
				const p = new CursorMovePrediction(direction, !!cursorMv[2], Number(cursorMv[1]) || 1);
				if (direction === CursorMoveDirection.Back) {
					addLeftNavigating(p);
				} else {
					addRightNavigating(p);
				}
				continue;
			}

			if (reader.eatStr(`${VT.Esc}f`)) {
				addRightNavigating(new CursorMovePrediction(CursorMoveDirection.Forwards, true, 1));
				continue;
			}

			if (reader.eatStr(`${VT.Esc}b`)) {
				addLeftNavigating(new CursorMovePrediction(CursorMoveDirection.Back, true, 1));
				continue;
			}

			if (reader.eatChar('\r') && buffer.cursorY < terminal.rows - 1) {
				this._timeline.addPrediction(buffer, new NewlinePrediction());
				continue;
			}

			this._timeline.addBoundary(buffer, new HardBoundary());
			break;
		}

		if (this._timeline.length === 1) {
			this._deferClearingPredictions();
			this._typeaheadStyle!.startTracking();
		}
	}

	private _onBeforeProcessData(event: IBeforeProcessDataEvent): void {
		if (!this._timeline) {
			return;
		}

		event.data = this._timeline.beforeServerInput(event.data);

		this._deferClearingPredictions();
	}
}

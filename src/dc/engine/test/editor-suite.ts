import { Position } from '../model/position';
import { Range } from '../model/range';
import { Selection } from '../model/selection';
import { PrefixSumComputer } from '../model/prefix-sum-computer';
import { IntervalTree, IIntervalNode } from '../model/interval-tree';
import { PieceTree } from '../model/piece-tree/piece-tree';
import { TextModel } from '../model/text-model';
import { URI } from '../../core/types/uri';
import { CursorWord, DEFAULT_WORD_SEPARATORS } from '../cursor/cursor-word';
import { expandTabs, escapeHtml } from '../view/view-line-rendering';
import { GrammarRegistry } from '../tokenizer/grammar-registry';
import { createSnapshot, snapshotToLines, snapshotToText, snapshotFromText, Snapshot } from '../model/snapshot';

export interface IEditorSuiteResult {
	readonly pass: number;
	readonly fail: number;
	readonly failures: string[];
}

interface ITestCase {
	readonly name: string;
	readonly run: () => void;
}

export function assert(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(`Assertion failed: ${message}`);
	}
}

export function assertEq(actual: unknown, expected: unknown, message: string): void {
	if (actual !== expected) {
		throw new Error(`Assertion failed: ${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
	}
}

const tests: ITestCase[] = [];

function test(name: string, run: () => void): void {
	tests.push({ name, run });
}

function withSuiteSetup(): void {
	test('Position statics: compare', () => {
		assertEq(Position.compare(new Position(1, 1), new Position(1, 1)), 0, 'equal positions');
		assert(Position.compare(new Position(1, 2), new Position(1, 1)) > 0, 'later column sorts after');
		assert(Position.compare(new Position(2, 1), new Position(1, 9)) > 0, 'later line sorts after');
		assert(Position.compare(new Position(1, 1), new Position(2, 1)) < 0, 'earlier line sorts before');
	});

	test('Position statics: min/max/equals', () => {
		const a = new Position(1, 5);
		const b = new Position(3, 1);
		assertEq(Position.min(a, b).lineNumber, 1, 'min picks line 1');
		assertEq(Position.max(a, b).lineNumber, 3, 'max picks line 3');
		assert(Position.equals(a, new Position(1, 5)), 'equals detects same position');
		assert(!Position.equals(a, b), 'equals rejects different positions');
	});

	test('Position statics: lift and isPosition', () => {
		const lifted = Position.lift({ lineNumber: 4, column: 7 });
		assert(lifted instanceof Position, 'lift returns Position instance');
		assertEq(lifted.lineNumber, 4, 'lift preserves line');
		assert(Position.isPosition(lifted), 'isPosition accepts IPosition');
		assert(!Position.isPosition(null), 'isPosition rejects null');
		assert(!Position.isPosition({ lineNumber: 1 }), 'isPosition rejects partial object');
	});

	test('Position instance: comparisons and delta', () => {
		const p = new Position(2, 3);
		assert(p.isBefore(new Position(2, 4)), 'isBefore on column');
		assert(p.isAfter(new Position(2, 2)), 'isAfter on column');
		assert(!p.isBeforeOrEqual(new Position(2, 3)), 'isBeforeOrEqual equal is false');
		assert(p.isBeforeOrEqual(new Position(2, 4)), 'isBeforeOrEqual earlier is true');
		const delta = p.delta(1, 2);
		assertEq(delta.lineNumber, 3, 'delta shifts line');
		assertEq(delta.column, 5, 'delta shifts column');
	});

	test('Range statics: contains', () => {
		const range = new Range(1, 2, 3, 4);
		assert(Range.containsPosition(range, new Position(2, 1)), 'contains inner position');
		assert(!Range.containsPosition(range, new Position(3, 5)), 'rejects out of bounds');
		assert(Range.containsRange(range, new Range(2, 1, 2, 5)), 'contains inner range');
		assert(!Range.containsRange(range, new Range(2, 1, 4, 5)), 'rejects larger range');
	});

	test('Range statics: intersection and adjacency', () => {
		const a = new Range(1, 1, 2, 1);
		const b = new Range(2, 2, 3, 1);
		assert(Range.areIntersecting(a, b), 'touching ranges intersect at line 2');
		const c = new Range(1, 1, 1, 10);
		const d = new Range(1, 11, 1, 20);
		assert(!Range.areIntersecting(c, d), 'disjoint ranges do not intersect');
		assert(Range.areAdjacent(c, d), 'adjacent ranges detected');
		const e = new Range(1, 1, 1, 10);
		const f = new Range(2, 1, 2, 5);
		assert(Range.areAdjacent(e, f), 'line adjacent ranges detected');
	});

	test('Range statics: collapse and edges', () => {
		const range = new Range(2, 3, 5, 8);
		const start = Range.collapseToStart(range);
		assertEq(start.startLineNumber, 2, 'collapse start line');
		assertEq(start.endColumn, 3, 'collapse start column');
		assert(Range.isEmpty(start), 'collapsed range is empty');
		const end = Range.collapseToEnd(range);
		assertEq(end.startLineNumber, 5, 'collapse end line');
		assertEq(end.endColumn, 8, 'collapse end column');
		assertEq(Range.startPosition(range).column, 3, 'startPosition');
		assertEq(Range.endPosition(range).column, 8, 'endPosition');
	});

	test('Range statics: fromPositions and plusRange', () => {
		const range = Range.fromPositions(new Position(1, 2), new Position(3, 4));
		assertEq(range.startLineNumber, 1, 'fromPositions start line');
		assertEq(range.endLineNumber, 3, 'fromPositions end line');
		assertEq(range.endColumn, 4, 'fromPositions end column');
		const merged = Range.plusRange(new Range(1, 1, 2, 1), new Range(5, 1, 6, 1));
		assertEq(merged.startLineNumber, 1, 'plusRange start');
		assertEq(merged.endLineNumber, 6, 'plusRange end');
	});

	test('Selection statics: fromPositions and direction', () => {
		const forward = Selection.fromPositions(new Position(1, 1), new Position(1, 5));
		assert(forward.isSelection, 'forward selection detected');
		assertEq(forward.direction, 'ltr', 'forward direction');
		const backward = Selection.fromPositions(new Position(1, 5), new Position(1, 1));
		assertEq(backward.direction, 'rtl', 'backward direction');
		assertEq(backward.start.column, 1, 'backward start normalized');
		assertEq(backward.end.column, 5, 'backward end normalized');
	});

	test('Selection statics: createReversed', () => {
		const forward = Selection.fromPositions(new Position(1, 1), new Position(1, 5));
		const reversed = Selection.createReversed(forward);
		assertEq(reversed.direction, 'rtl', 'reversed direction');
		assertEq(reversed.anchor.column, 5, 'reversed anchor');
		assertEq(reversed.active.column, 1, 'reversed active');
	});

	test('Selection statics: isBefore/isAfter', () => {
		const a = new Selection(1, 1, 1, 5);
		const b = new Selection(2, 1, 2, 1);
		assert(Selection.isBefore(a, b), 'selection before another');
		assert(Selection.isAfter(b, a), 'selection after another');
	});

	test('PrefixSumComputer: prefix sums and binary search', () => {
		const computer = new PrefixSumComputer([2, 3, 5]);
		assertEq(computer.getTotalValue(), 10, 'total value');
		assertEq(computer.getPrefixSum(2), 5, 'prefix sum at 2');
		assertEq(computer.getPrefixSum(3), 10, 'prefix sum at end');
		assertEq(computer.getIndexOf(0), 0, 'index of zero');
		assertEq(computer.getIndexOf(2), 0, 'index within first value');
		assertEq(computer.getIndexOf(3), 1, 'index crossing boundary');
		assertEq(computer.getIndexOf(10), 2, 'index at total');
		assertEq(computer.getIndexOf(100), 2, 'index beyond total clamps');
	});

	test('PrefixSumComputer: incremental update', () => {
		const computer = new PrefixSumComputer([1, 1, 1]);
		computer.setValue(1, 4);
		assertEq(computer.getTotalValue(), 6, 'total after update');
		assertEq(computer.getPrefixSum(2), 5, 'prefix after update');
		assertEq(computer.getIndexOf(5), 1, 'index after update');
		computer.setValues([10, 10]);
		assertEq(computer.getTotalValue(), 20, 'total after reset');
		assertEq(computer.getCount(), 2, 'count after reset');
	});

	test('IntervalTree: insert, search, delete', () => {
		const tree = new IntervalTree();
		const a: IIntervalNode = { id: 'a', start: 1, end: 5 };
		const b: IIntervalNode = { id: 'b', start: 3, end: 8 };
		const c: IIntervalNode = { id: 'c', start: 6, end: 9 };
		tree.insert(a);
		tree.insert(b);
		tree.insert(c);
		assertEq(tree.getSize(), 3, 'tree size');
		assertEq(tree.getMaxEnd(), 9, 'max end');
		const found = tree.search(4, 4);
		assertEq(found.length, 2, 'search at 4 finds two intervals');
		tree.delete(b);
		assertEq(tree.getSize(), 2, 'size after delete');
		assertEq(tree.getMaxEnd(), 9, 'max end after delete');
		const remaining = tree.search(4, 4);
		assertEq(remaining.length, 1, 'search after delete');
		assertEq(remaining[0].id, 'a', 'remaining interval identity');
		tree.clear();
		assertEq(tree.getSize(), 0, 'tree empty after clear');
	});

	test('IntervalTree: getAll ordering', () => {
		const tree = new IntervalTree();
		tree.insert({ id: 'd', start: 4, end: 6 });
		tree.insert({ id: 'e', start: 1, end: 2 });
		const all = tree.getAll();
		assertEq(all.length, 2, 'getAll count');
		assert(all[0].start < all[1].start, 'getAll sorted by start');
	});

	test('PieceTree: basic getContent and line count', () => {
		const tree = new PieceTree('line1\nline2\nline3');
		assertEq(tree.getContent(), 'line1\nline2\nline3', 'initial content');
		assertEq(tree.getLineCount(), 3, 'line count');
	});

	test('PieceTree: insert at start, middle, end', () => {
		const tree = new PieceTree('abc');
		tree.insert(0, 'X');
		assertEq(tree.getContent(), 'Xabc', 'insert at start');
		tree.insert(2, 'Y');
		assertEq(tree.getContent(), 'XaYbc', 'insert in middle');
		tree.insert(6, 'Z');
		assertEq(tree.getContent(), 'XaYbcZ', 'insert at end');
		assertEq(tree.getLineCount(), 1, 'line count unchanged without newlines');
	});

	test('PieceTree: insert with newlines updates line count', () => {
		const tree = new PieceTree('ab');
		tree.insert(1, '\n');
		assertEq(tree.getContent(), 'a\nb', 'newline inserted');
		assertEq(tree.getLineCount(), 2, 'line count incremented');
	});

	test('TextModel: setValue and getters', () => {
		const model = new TextModel(URI.from({ scheme: 'untitled', path: 't' }), 'a\nb\nc');
		assertEq(model.getValue(), 'a\nb\nc', 'initial value');
		assertEq(model.getLineCount(), 3, 'line count');
		assertEq(model.getLineContent(2), 'b', 'line content');
		assertEq(model.getLineContent(99), '', 'missing line returns empty');
		model.setValue('x');
		assertEq(model.getValue(), 'x', 'value after set');
		assertEq(model.getLineCount(), 1, 'line count after set');
	});

	test('TextModel: onDidChangeContent fires', () => {
		const model = new TextModel(URI.from({ scheme: 'untitled', path: 't' }), 'a');
		let fired: string | null = null;
		const d = model.onDidChangeContent(e => { fired = e.text; });
		model.setValue('hello');
		d.dispose();
		assertEq(fired, 'hello', 'change event payload');
	});

	test('CursorWord: word separators and wordAt', () => {
		assert(CursorWord.isWordSeparator('.', DEFAULT_WORD_SEPARATORS), 'dot is separator');
		assert(!CursorWord.isWordSeparator('a', DEFAULT_WORD_SEPARATORS), 'letter is not separator');
		const model = new TextModel(URI.from({ scheme: 'untitled', path: 't' }), 'hello world');
		const word = CursorWord.wordAt(model, new Position(1, 3), DEFAULT_WORD_SEPARATORS);
		assertEq(word?.start.column, 1, 'word start');
		assertEq(word?.end.column, 6, 'word end');
	});

	test('CursorWord: moveWordLeft/moveWordRight', () => {
		const model = new TextModel(URI.from({ scheme: 'untitled', path: 't' }), 'hello world');
		const left = CursorWord.moveWordLeft(model, new Position(1, 8), DEFAULT_WORD_SEPARATORS);
		assertEq(left.column, 7, 'move word left lands at previous word start');
		const right = CursorWord.moveWordRight(model, new Position(1, 1), DEFAULT_WORD_SEPARATORS);
		assertEq(right.column, 6, 'move word right lands at next word end');
	});

	test('Snapshot: round trip', () => {
		const snapshot = createSnapshot(['a', 'b', 'c']);
		assertEq(snapshotToLines(snapshot).join(','), 'a,b,c', 'snapshot to lines');
		const fresh = createSnapshot(['a', 'b', 'c']);
		assertEq(snapshotToText(fresh), 'a\nb\nc', 'snapshot to text');
		const fromText = snapshotFromText('x\ny');
		assertEq(snapshotToText(fromText), 'x\ny', 'snapshot from text');
		assertEq(new Snapshot(['a', 'b', 'c']).getLineCount(), 3, 'snapshot line count');
	});

	test('View helpers: expandTabs and escapeHtml', () => {
		assertEq(expandTabs('\t', 4), '    ', 'tab expanded to 4 spaces');
		assertEq(expandTabs('a\tb', 4), 'a   b', 'tab aligns to tab stop');
		assertEq(escapeHtml('<a&"b\'>'), '&lt;a&amp;&quot;b&#39;&gt;', 'html escaping');
	});

	test('GrammarRegistry: tokenizes keywords and strings', () => {
		const registry = new GrammarRegistry();
		const grammar = registry.getGrammarForLanguageId('typescript');
		const result = grammar.tokenizeLine('const s = "hi";');
		const classes = result.tokens.map(t => t.scopes[0]);
		assert(classes.includes('keyword'), 'keyword scope present');
		assert(classes.includes('string.quoted'), 'string scope present');
	});

	test('GrammarRegistry: file name resolution', () => {
		const registry = new GrammarRegistry();
		assertEq(registry.getLanguageIdForFileName('app.ts'), 'typescript', 'ts file maps to typescript');
		assertEq(registry.getLanguageIdForFileName('style.css'), 'css', 'css file maps to css');
		assertEq(registry.getLanguageIdForFileName('readme.md'), 'markdown', 'md file maps to markdown');
		assertEq(registry.getGrammarByFileName('a.py').id, 'dc.python', 'python grammar lookup');
		assertEq(registry.getGrammarByFileName('unknown.xyz').id, 'dc.plaintext', 'unknown maps to plaintext');
	});
}

withSuiteSetup();

export interface IRunResult {
	readonly pass: number;
	readonly fail: number;
	readonly failures: string[];
}

export async function run(): Promise<IEditorSuiteResult> {
	const failures: string[] = [];
	let pass = 0;
	for (const testCase of tests) {
		try {
			testCase.run();
			pass++;
		} catch (error) {
			failures.push(`${testCase.name}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { pass, fail: failures.length, failures };
}

export function runEditorSuite(): Promise<IRunResult> {
	return run();
}

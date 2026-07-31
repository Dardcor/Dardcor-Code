/**
 * Dardcor Code - App-Shell Layout & UI Components Unit Test Suite
 */

import { EditorGroupModel } from '../parts/editor/editor-group-model.js';
import { EditorGroupGrid } from '../parts/editor/editor-group-grid.js';
import { EditorReopenClosed } from '../parts/editor/editor-reopen-closed.js';
import { FileEditorInput } from '../parts/editor/editor-input.js';
import { EditorCopyPath } from '../parts/editor/editor-copy-path.js';
import { EditorEncoding, detectEncodingFromBom, encodeText, decodeText, convertEncoding } from '../parts/editor/editor-encoding.js';
import { LineEnding, detectLineEnding, convertLineEnding } from '../parts/editor/editor-eol.js';
import { detectIndentation, renderIndent } from '../parts/editor/editor-indentation.js';
import { LanguageRegistry } from '../parts/editor/editor-language-selector.js';
import { PanelDockPosition } from '../parts/panel/panel-dock-position.js';
import { computeActivitybarLayout } from '../parts/activitybar/activitybar-layout.js';
import { StatusbarEntryBuilder, buildStatusbarEntry } from '../parts/statusbar/statusbar-entry-builder.js';
import { StatusbarAlignment } from '../parts/statusbar/statusbar-registry.js';
import { URI } from '../../core/types/uri.js';
import { Disposable } from '../../core/lifecycle/disposable.js';

export interface ITestResult {
	readonly name: string;
	readonly passed: boolean;
	readonly message?: string;
}

export interface ITestSuiteReport {
	readonly results: ITestResult[];
	readonly passed: number;
	readonly failed: number;
	toString(): string;
}

export class TestSuite {
	private readonly _results: ITestResult[] = [];

	run(name: string, fn: () => void | Promise<void>): void {
		try {
			const result = fn();
			if (result && typeof (result as Promise<void>).then === 'function') {
				(result as Promise<void>).then(
					() => this._record(name, true),
					err => this._record(name, false, String(err))
				);
				return;
			}
			this._record(name, true);
		} catch (err) {
			this._record(name, false, err instanceof Error ? err.message : String(err));
		}
	}

	skip(name: string, reason: string): void {
		this._record(name, true, `skipped: ${reason}`);
	}

	report(): ITestSuiteReport {
		const passed = this._results.filter(r => r.passed).length;
		const failed = this._results.length - passed;
		const lines = [`SUITE app-shell: ${passed} passed, ${failed} failed`];
		for (const result of this._results) {
			lines.push(`- [${result.passed ? 'PASS' : 'FAIL'}] ${result.name}${result.message ? ` (${result.message})` : ''}`);
		}
		const text = lines.join('\n');
		return {
			results: [...this._results],
			passed,
			failed,
			toString: () => text,
		};
	}

	private _record(name: string, passed: boolean, message?: string): void {
		this._results.push({ name, passed, message });
	}
}

function assert(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
	if (actual !== expected) {
		throw new Error(`${message}: expected '${String(expected)}', got '${String(actual)}'`);
	}
}

export function runAppShellSuite(): ITestSuiteReport {
	const suite = new TestSuite();
	const hasDom = typeof document !== 'undefined';

	// --- editor-group-model ---
	suite.run('editor-group-model: open/close/active state', () => {
		const model = new EditorGroupModel();
		const a = new FileEditorInput(URI.from({ scheme: 'file', path: '/root/a.ts' }), 'a');
		const b = new FileEditorInput(URI.from({ scheme: 'file', path: '/root/b.ts' }), 'b');
		const c = new FileEditorInput(URI.from({ scheme: 'file', path: '/root/c.ts' }), 'c');
		model.open(a);
		model.open(b);
		model.open(c);
		assertEqual(model.count, 3, 'count');
		assertEqual(model.activeInput, c, 'active is last opened');
		assertEqual(model.indexOf(b), 1, 'index of b');
		assert(model.close(b), 'close b returns true');
		assertEqual(model.count, 2, 'count after close');
		assert(model.activeInput === c || model.activeInput === a, 'fallback active after close');
		model.dispose();
		a.dispose();
		b.dispose();
		c.dispose();
	});

	suite.run('editor-group-model: pinned reorder and move', () => {
		const model = new EditorGroupModel();
		const a = new FileEditorInput(URI.from({ scheme: 'file', path: '/root/a.ts' }), 'a');
		const b = new FileEditorInput(URI.from({ scheme: 'file', path: '/root/b.ts' }), 'b');
		const c = new FileEditorInput(URI.from({ scheme: 'file', path: '/root/c.ts' }), 'c');
		model.open(a);
		model.open(b);
		model.open(c);
		model.moveToPinned(a, true);
		assertEqual(model.indexOf(a), 0, 'pinned a moves to front');
		model.move(2, 1);
		assertEqual(model.getEditors().map(i => i.getName()).join(','), 'a.ts,c.ts,b.ts', 'move reorders');
		assert(model.isPinned(a), 'a stays pinned');
		model.dispose();
		a.dispose();
		b.dispose();
		c.dispose();
	});

	// --- editor-group-grid ---
	suite.run('editor-group-grid: 2x2 grid layout computation', () => {
		const cells = EditorGroupGrid.computeGrid(4, 800, 600, 2, 0);
		assertEqual(cells.length, 4, 'four cells');
		assertEqual(cells[1].column, 1, 'second cell column');
		assertEqual(cells[2].row, 1, 'third cell row');
		assertEqual(cells[2].y, 300, 'third cell y');
		assertEqual(cells[0].width, 400, 'cell width');
	});

	suite.run('editor-group-grid: split targets for 3 groups', () => {
		const targets = EditorGroupGrid.computeSplitTargets(3, 2);
		assert(targets.length > 0, 'has targets');
		assertEqual(EditorGroupGrid.computeInsertionPoint(3, 2).index, 2, 'insert at last index');
	});

	// --- editor-reopen-closed ---
	suite.run('editor-reopen-closed: stack push and reopen', () => {
		const tracker = new EditorReopenClosed(null, { rememberContent: true });
		const a = new FileEditorInput(URI.from({ scheme: 'file', path: '/root/a.ts' }), 'content-a');
		tracker.push(a);
		tracker.push(new FileEditorInput(URI.from({ scheme: 'file', path: '/root/b.ts' }), 'content-b'));
		assertEqual(tracker.stackSize, 2, 'stack size');
		const entry = tracker.reopen();
		assertEqual(entry?.name, 'b.ts', 'reopens most recent');
		assertEqual(entry?.contentSnapshot, 'content-b', 'content snapshot');
		assertEqual(tracker.stackSize, 1, 'stack pops');
		tracker.dispose();
		a.dispose();
	});

	suite.run('editor-reopen-closed: dedupe and max size', () => {
		const tracker = new EditorReopenClosed(null, { maxStackSize: 2 });
		const a = new FileEditorInput(URI.from({ scheme: 'file', path: '/root/a.ts' }), 'a');
		const b = new FileEditorInput(URI.from({ scheme: 'file', path: '/root/b.ts' }), 'b');
		const c = new FileEditorInput(URI.from({ scheme: 'file', path: '/root/c.ts' }), 'c');
		tracker.push(a);
		tracker.push(b);
		tracker.push(c);
		assertEqual(tracker.stackSize, 2, 'max size enforced');
		tracker.push(a);
		assertEqual(tracker.stackSize, 2, 'dedupe keeps size');
		tracker.dispose();
		a.dispose();
		b.dispose();
		c.dispose();
	});

	// --- editor-eol ---
	suite.run('editor-eol: detect and convert line endings', () => {
		assertEqual(detectLineEnding('a\nb\nc'), LineEnding.LF, 'lf detected');
		assertEqual(detectLineEnding('a\r\nb\r\n'), LineEnding.CRLF, 'crlf detected');
		assertEqual(convertLineEnding('a\r\nb\n', LineEnding.CRLF), 'a\r\nb\r\n', 'convert to crlf');
		assertEqual(convertLineEnding('a\r\nb\n', LineEnding.LF), 'a\nb\n', 'convert to lf');
	});

	// --- editor-indentation ---
	suite.run('editor-indentation: detection and rendering', () => {
		const info = detectIndentation('function a() {\n    return 1;\n}');
		assertEqual(info.insertSpaces, true, 'spaces detected');
		assertEqual(info.tabSize, 4, 'tab size 4 detected');
		assertEqual(renderIndent(4, true), '    ', 'render spaces');
		assertEqual(renderIndent(4, false), '\t'.repeat(4), 'render tabs');
	});

	// --- editor-encoding ---
	suite.run('editor-encoding: utf8/utf16/latin1 roundtrip', () => {
		const text = 'H\u00e9llo \u4f60\u597d';
		const utf8 = encodeText(text, EditorEncoding.UTF8);
		assertEqual(decodeText(utf8, EditorEncoding.UTF8), text, 'utf8 roundtrip');
		const utf16le = encodeText(text, EditorEncoding.UTF16LE, true);
		assertEqual(decodeText(utf16le, EditorEncoding.UTF16LE), text, 'utf16le roundtrip with BOM');
		assertEqual(detectEncodingFromBom(utf16le), EditorEncoding.UTF16LE, 'utf16le BOM detected');
		const utf16be = encodeText(text, EditorEncoding.UTF16BE, true);
		assertEqual(decodeText(utf16be, EditorEncoding.UTF16BE), text, 'utf16be roundtrip with BOM');
		assertEqual(detectEncodingFromBom(utf16be), EditorEncoding.UTF16BE, 'utf16be BOM detected');
		const latin = encodeText('caf\u00e9', EditorEncoding.ISO88591);
		assertEqual(decodeText(latin, EditorEncoding.ISO88591), 'caf\u00e9', 'latin1 roundtrip');
		const converted = convertEncoding(utf8, EditorEncoding.UTF8, EditorEncoding.UTF16LE, true);
		assertEqual(decodeText(converted, EditorEncoding.UTF16LE), text, 'convert utf8 to utf16le');
	});

	// --- editor-language-selector ---
	suite.run('editor-language-selector: extension detection', () => {
		const registry = new LanguageRegistry();
		assertEqual(registry.detectLanguage(URI.from({ scheme: 'file', path: '/root/app.ts' })), 'typescript', 'ts detected');
		assertEqual(registry.detectLanguage(URI.from({ scheme: 'file', path: '/root/style.css' })), 'css', 'css detected');
		assertEqual(registry.detectLanguage(URI.from({ scheme: 'file', path: '/root/readme.md' })), 'markdown', 'md detected');
		assertEqual(registry.detectLanguage(URI.from({ scheme: 'file', path: '/root/data.xyz' })), 'plaintext', 'unknown -> plaintext');
		registry.dispose();
	});

	// --- editor-copy-path ---
	suite.run('editor-copy-path: relative path computation', () => {
		const copy = new EditorCopyPath({ workspaceRoot: '/home/user/project' });
		assertEqual(copy.getRelativePath(URI.from({ scheme: 'file', path: '/home/user/project/src/main.ts' })), 'src/main.ts', 'relative inside root');
		assertEqual(copy.getRelativePath(URI.from({ scheme: 'file', path: '/home/user/project/package.json' })), 'package.json', 'relative at root');
		assertEqual(copy.getRelativePath(URI.from({ scheme: 'file', path: '/elsewhere/file.ts' })), '/elsewhere/file.ts', 'outside root keeps absolute');
	});

	// --- statusbar-entry-builder ---
	suite.run('statusbar-entry-builder: fluent construction', () => {
		const entry = StatusbarEntryBuilder.fromOptions({ id: 'test.entry', alignment: StatusbarAlignment.RIGHT, priority: 5 })
			.text('Ready')
			.tooltip('Ready tooltip')
			.command('workbench.action.test')
			.color('#ff0000')
			.build();
		assertEqual(entry.id, 'test.entry', 'id');
		assertEqual(entry.text, 'Ready', 'text');
		assertEqual(entry.alignment, StatusbarAlignment.RIGHT, 'alignment');
		assertEqual(entry.commandId, 'workbench.action.test', 'command');
		const built = buildStatusbarEntry({ id: 'x', text: 'X', priority: 1 });
		assertEqual(built.priority, 1, 'build helper');
	});

	// --- activitybar-layout ---
	suite.run('activitybar-layout: top/bottom positioning', () => {
		const result = computeActivitybarLayout(4, 2, 500);
		assertEqual(result.topActions.length, 4, 'four top actions');
		assertEqual(result.bottomActions.length, 2, 'two bottom actions');
		assertEqual(result.topActions[1].y, 8 + 44, 'second action y');
		assert(result.bottomActions[0].y < result.bottomActions[1].y, 'bottom actions stacked upward');
	});

	// --- window-title ---
	if (hasDom) {
		suite.run('window-title: format', () => {
			return (async () => {
				const { WindowTitle } = await import('../parts/titlebar/window-title.js');
				const { EditorPart } = await import('../parts/editor/editor-part.js');
				const container = document.createElement('div');
				const part = new EditorPart(container);
				const title = new WindowTitle(part, { workspaceName: 'My Workspace' });
				assertEqual(title.computeTitle(new FileEditorInput(URI.from({ scheme: 'file', path: '/root/app.ts' }), 'x')), 'app.ts - My Workspace - Dardcor Code', 'full format');
				assertEqual(title.computeTitle(null), 'My Workspace - Dardcor Code', 'no file format');
				title.dispose();
				part.dispose();
			})();
		});
	} else {
		suite.skip('window-title: format', 'no DOM');
	}

	// --- panel-dock-position ---
	if (hasDom) {
		suite.run('panel-dock-position: cycle and move', () => {
			const container = document.createElement('div');
			const dock = new PanelDockPosition({ container, initialPosition: 'bottom' });
			const next = dock.cycle();
			assertEqual(next, 'right', 'cycle bottom -> right');
			assertEqual(dock.position, 'right', 'position updated');
			dock.moveToLeft();
			assertEqual(dock.position, 'left', 'move to left');
			assertEqual(dock.getOptions().length, 3, 'three options');
			dock.dispose();
		});
	} else {
		suite.skip('panel-dock-position: cycle and move', 'no DOM');
	}

	// --- editor-group-grid DOM variant via model ---
	suite.run('editor-group-grid: computeDimensions', () => {
		const dims = EditorGroupGrid.computeDimensions(5, 2);
		assertEqual(dims.rows, 3, 'rows for 5 groups');
		assertEqual(dims.columns, 2, 'columns');
	});

	return suite.report();
}

export function runAppShellSuiteToString(): string {
	return runAppShellSuite().toString();
}

export function disposeAppShellTestFixtures(fixtures: Disposable[]): void {
	for (const fixture of fixtures) {
		fixture.dispose();
	}
}

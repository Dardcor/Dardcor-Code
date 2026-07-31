/**
 * Dardcor Code - Built-in Workbench Modules Unit Test Suite
 */

import { SettingsGroupModel } from '../settings/settings-group-model';
import { DEFAULT_SETTINGS } from '../settings/settings-editor';
import { KeybindingsSearch } from '../keybindings/keybindings-search';
import { MergeConflictParser } from '../scm/git-merge-editor';
import { ChatIntentParser } from '../chat/chat-intent-parser';
import { TerminalQuickFix } from '../terminal/terminal-quick-fix';
import { SearchNotebookProvider } from '../search/search-notebook';
import { ExtensionUpdateChecker } from '../extensions/extension-update-checker';
import { DiagnosticsModel, DiagnosticSeverity } from '../problems/diagnostics-model';
import { OutlineParser, OutlineSymbolKind } from '../outline/outline-view';
import { URI } from '../../core/types/uri';

export interface ITestResult {
	readonly name: string;
	readonly passed: boolean;
	readonly error?: string;
}

export interface ITestReport {
	readonly total: number;
	readonly passed: number;
	readonly failed: number;
	readonly results: ITestResult[];
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
	if (actual !== expected) {
		throw new Error(message ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

export function assertTrue(condition: boolean, message?: string): void {
	if (!condition) {
		throw new Error(message ?? 'Expected condition to be true');
	}
}

export function assertArrayLength<T>(actual: readonly T[], expected: number, message?: string): void {
	if (actual.length !== expected) {
		throw new Error(message ?? `Expected array length ${expected}, got ${actual.length}`);
	}
}

class TestRunner {
	private readonly _results: ITestResult[] = [];
	private _passed = 0;
	private _failed = 0;

	public test(name: string, fn: () => void): void {
		try {
			fn();
			this._passed++;
			this._results.push({ name, passed: true });
		} catch (err) {
			this._failed++;
			this._results.push({ name, passed: false, error: err instanceof Error ? err.message : String(err) });
		}
	}

	public report(): ITestReport {
		return {
			total: this._results.length,
			passed: this._passed,
			failed: this._failed,
			results: [...this._results]
		};
	}
}

export function runModulesSuite(): ITestReport {
	const runner = new TestRunner();

	runner.test('SettingsGroupModel membangun hierarki kategori', () => {
		const model = new SettingsGroupModel(DEFAULT_SETTINGS);
		assertEqual(model.count, DEFAULT_SETTINGS.length);
		assertEqual(model.root.children.length, 7);
		const group = model.getGroup('group:Editor');
		assertTrue(!!group);
		assertTrue((group?.settings.length ?? 0) > 0);
		assertTrue(!!model.getSetting('editor.fontSize'));
		assertEqual(model.getSetting('editor.tabSize')?.defaultValue, 4);
	});

	runner.test('SettingsGroupModel mengindeks setting dalam grup', () => {
		const model = new SettingsGroupModel(DEFAULT_SETTINGS);
		const group = model.getGroupOfSetting('git.enabled');
		assertEqual(group?.id, 'group:Git');
		const settings = model.getSettingsInGroup('group:Terminal');
		assertTrue(settings.some(s => s.key === 'terminal.integrated.shell'));
	});

	runner.test('KeybindingsSearch mencocokkan perintah', () => {
		const entries = [
			{ commandId: 'workbench.action.save', title: 'Save', keybinding: 'Ctrl+S', source: 'default' as const },
			{ commandId: 'workbench.action.openSearch', title: 'Open Search', keybinding: 'Ctrl+Shift+F', source: 'default' as const }
		];
		const results = KeybindingsSearch.search('save', entries);
		assertEqual(results.length, 1);
		assertEqual(results[0].entry.commandId, 'workbench.action.save');
	});

	runner.test('KeybindingsSearch mencocokkan kombinasi tombol', () => {
		const entries = [
			{ commandId: 'workbench.action.save', title: 'Save', keybinding: 'Ctrl+S', source: 'default' as const },
			{ commandId: 'workbench.action.openSearch', title: 'Open Search', keybinding: 'Ctrl+Shift+F', source: 'default' as const }
		];
		const results = KeybindingsSearch.search('ctrl+shift', entries);
		assertEqual(results.length, 1);
		assertEqual(results[0].entry.commandId, 'workbench.action.openSearch');
	});

	runner.test('MergeConflictParser memisahkan tiga sisi konflik', () => {
		const content = [
			'line1',
			'<<<<<<< HEAD',
			'current-value',
			'=======',
			'incoming-value',
			'>>>>>>> feature',
			'line2'
		].join('\n');
		const conflicts = MergeConflictParser.parse(content);
		assertEqual(conflicts.length, 1);
		assertEqual(conflicts[0].current, 'current-value');
		assertEqual(conflicts[0].incoming, 'incoming-value');
		assertEqual(conflicts[0].startLine, 2);
		assertEqual(conflicts[0].endLine, 6);
	});

	runner.test('MergeConflictParser resolve accept incoming', () => {
		const content = ['<<<<<<< HEAD', 'A', '=======', 'B', '>>>>>>> f'].join('\n');
		const conflicts = MergeConflictParser.parse(content);
		const resolved = MergeConflictParser.resolve(content, conflicts, () => 'incoming');
		assertEqual(resolved, 'A');
	});

	runner.test('MergeConflictParser resolve accept both', () => {
		const content = ['<<<<<<< HEAD', 'A', '=======', 'B', '>>>>>>> f'].join('\n');
		const conflicts = MergeConflictParser.parse(content);
		const resolved = MergeConflictParser.resolve(content, conflicts, () => 'both');
		assertEqual(resolved, 'A\nB');
	});

	runner.test('MergeConflictParser mendeteksi tanpa konflik', () => {
		assertTrue(!MergeConflictParser.hasConflicts('halo dunia'));
		assertTrue(MergeConflictParser.hasConflicts('<<<<<<< HEAD\na\n=======\nb\n>>>>>>> f'));
	});

	runner.test('ChatIntentParser mengenali /explain', () => {
		const intent = ChatIntentParser.parse('/explain file.ts');
		assertEqual(intent.kind, 'explain');
		assertEqual(intent.command, '/explain');
		assertEqual(intent.target, 'file.ts');
	});

	runner.test('ChatIntentParser fallback ke ask', () => {
		const intent = ChatIntentParser.parse('apa itu promise?');
		assertEqual(intent.kind, 'ask');
		assertEqual(intent.command, '');
	});

	runner.test('ChatIntentParser mengekstrak mention', () => {
		const mentions = ChatIntentParser.extractMentions('/fix @src/main.ts @workspace');
		assertEqual(mentions.length, 2);
	});

	runner.test('TerminalQuickFix mendeteksi perintah tidak dikenal', () => {
		const fix = TerminalQuickFix.detect("'gti' is not recognized as an internal or external command", ['git']);
		assertTrue(!!fix);
		assertEqual(fix?.suggestion, 'git');
	});

	runner.test('TerminalQuickFix.levenshtein dasar', () => {
		assertEqual(TerminalQuickFix.levenshtein('kitten', 'sitting'), 3);
		assertEqual(TerminalQuickFix.levenshtein('git', 'git'), 0);
		assertEqual(TerminalQuickFix.levenshtein('', 'abc'), 3);
	});

	runner.test('SearchNotebookProvider parse notebook JSON', () => {
		const notebook = JSON.stringify({
			cells: [
				{ cell_type: 'markdown', source: ['# Judul'] },
				{ cell_type: 'code', source: ['print("halo")'], execution_count: 1 }
			]
		});
		const cells = SearchNotebookProvider.parseNotebook(notebook);
		assertEqual(cells.length, 2);
		assertEqual(cells[0].kind, 'markdown');
		assertEqual(cells[1].kind, 'code');
	});

	runner.test('SearchNotebookProvider mencari isi sel', () => {
		const cells = SearchNotebookProvider.parseNotebook(JSON.stringify({
			cells: [
				{ cell_type: 'markdown', source: ['Dokumentasi'] },
				{ cell_type: 'code', source: ['const x = 10;'] }
			]
		}));
		const provider = new SearchNotebookProvider();
		provider.setCells(cells);
		const matches = provider.search('const');
		assertEqual(matches.length, 1);
		assertEqual(matches[0].cellIndex, 1);
		assertEqual(matches[0].matchText, 'const');
	});

	runner.test('ExtensionUpdateChecker membandingkan versi', () => {
		assertTrue(ExtensionUpdateChecker.isNewerVersion('2.0.0', '1.0.0'));
		assertTrue(!ExtensionUpdateChecker.isNewerVersion('1.0.0', '2.0.0'));
		assertTrue(!ExtensionUpdateChecker.isNewerVersion('1.0.0', '1.0.0'));
		assertTrue(ExtensionUpdateChecker.isNewerVersion('1.1.0', '1.0.9'));
	});

	runner.test('DiagnosticsModel menghitung severity', () => {
		const model = new DiagnosticsModel();
		const uri = URI.file('test.ts');
		model.setDiagnostics(uri, [
			{ message: 'err', severity: DiagnosticSeverity.Error, line: 1, column: 1 },
			{ message: 'warn', severity: DiagnosticSeverity.Warning, line: 2, column: 1 }
		]);
		assertEqual(model.errorCount, 1);
		assertEqual(model.warningCount, 1);
		assertEqual(model.totalCount, 2);
		assertEqual(model.getDiagnosticsAt(uri, 2).length, 1);
	});

	runner.test('OutlineParser mengenali class dan function', () => {
		const source = 'export class Foo {\n\tbar(): void {}\n}\n\nexport function baz() {}';
		const symbols = OutlineParser.parse(source);
		const classSymbol = symbols.find(s => s.kind === OutlineSymbolKind.Class);
		const fnSymbol = symbols.find(s => s.name === 'baz');
		assertTrue(!!classSymbol);
		assertEqual(classSymbol?.name, 'Foo');
		assertTrue(!!fnSymbol);
		assertEqual(fnSymbol?.kind, OutlineSymbolKind.Function);
	});

	runner.test('OutlineParser mengukur kedalaman', () => {
		const source = 'export class A {\n\tmethod() {}\n}';
		const symbols = OutlineParser.parse(source);
		const method = symbols.find(s => s.name === 'method');
		assertTrue(!!method);
		assertTrue((method?.depth ?? 0) >= 1);
	});

	return runner.report();
}

export function printReport(report: ITestReport): void {
	for (const result of report.results) {
		if (result.passed) {
			console.log(`  \u2713 ${result.name}`);
		} else {
			console.error(`  \u2715 ${result.name} \u2014 ${result.error ?? ''}`);
		}
	}
	console.log(`\n${report.passed}/${report.total} tes lulus${report.failed > 0 ? `, ${report.failed} gagal` : ''}`);
}

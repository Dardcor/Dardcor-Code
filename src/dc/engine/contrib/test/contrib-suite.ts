/**
 * Dardcor Code - Editor Feature Contributions Test Suite
 */

import { TextModel } from "../../model/text-model.js";
import { URI } from "../../../core/types/uri.js";
import { InMemoryStorageService, StorageScope, StorageTarget } from "../../../services/storage/storage-service.js";
import { CompletionItem } from "../suggest/completion-item.js";
import { scoreSuggestion, sortSuggestions } from "../suggest/suggest-sorting.js";
import { fuzzyMatch, SuggestFilter } from "../suggest/suggest-filter.js";
import { HoverPositionCalculator } from "../hover/hover-position.js";
import { FoldingImports } from "../folding/folding-imports.js";
import { FoldingComments } from "../folding/folding-comments.js";
import { FindHistory } from "../find/find-history.js";
import { CodeLensCache } from "../codelens/codelens-cache.js";
import { GhostTextModel } from "../inline-completions/ghost-text-model.js";
import { SuggestMemory } from "../suggest/suggest-memory.js";
import { WorkspaceSymbolProviderRegistry, IndexedWorkspaceSymbolProvider } from "../goto-symbol/workspace-symbol-provider.js";
import { CommitCharactersHandler } from "../suggest/suggest-commit-characters.js";
import { FoldingPersistence } from "../folding/folding-persistence.js";
import { FoldingModel } from "../folding/folding-model.js";

export interface ISuiteResult {
	readonly name: string;
	readonly passed: boolean;
	readonly error: string | null;
	readonly durationMs: number;
}

export interface ISuiteReport {
	readonly results: readonly ISuiteResult[];
	readonly total: number;
	readonly passed: number;
	readonly failed: number;
	readonly summary: string;
}

function assert(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
	if (actual !== expected) {
		throw new Error(`${message} - expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

async function run(name: string, fn: () => void | Promise<void>): Promise<ISuiteResult> {
	const startedAt = Date.now();
	try {
		await fn();
		return { name, passed: true, error: null, durationMs: Date.now() - startedAt };
	} catch (error) {
		return { name, passed: false, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt };
	}
}

function makeModel(text: string, path: string = "/test/file.ts"): TextModel {
	return new TextModel(URI.file(path), text);
}

function makeItem(label: string, detail: string = "test"): CompletionItem {
	return new CompletionItem({ label, detail, filterText: label, sortText: label });
}

function testSuggestSorting(): void {
	const query = "fs";
	const matches = ["fs", "mfsx", "xyzfs", "fzzzsz", "FizzBuzz"];
	const items = matches.map(label => makeItem(label));
	const sorted = sortSuggestions(items, query);
	assertEqual(sorted.length, matches.length, "all matching items survive sorting");
	assertEqual(sorted[0].item.label, "fs", "exact match sorts first");
	assertEqual(sorted[1].item.label, "mfsx", "substring match sorts before fuzzy");
	assertEqual(sorted[sorted.length - 1].item.label, "FizzBuzz", "weakest fuzzy match sorts last");
	assertEqual(sorted[0].result.matchKind, "exact", "match kind classified");
	const prefix = scoreSuggestion("fs", "fsm");
	assertEqual(prefix.matchKind, "prefix", "prefix kind detected");
	const none = scoreSuggestion("zzz", "abc");
	assert(none.score < 0, "non matching query returns negative score");
}

function testSuggestFilter(): void {
	const items = [makeItem("promise"), makeItem("proxy"), makeItem("render")];
	const results = new SuggestFilter().filter("pr", items);
	assertEqual(results.length, 2, "fuzzy filter keeps subsequence matches");
	assertEqual(results[0].item.label, "proxy", "ranked first by score");
	assert(fuzzyMatch("pr", "proxy") !== null, "fuzzy match found");
	assert(fuzzyMatch("xyz", "proxy") === null, "no match returns null");
}

function testHoverPosition(): void {
	const viewport = { width: 600, height: 400 };
	const anchor = { x: 100, y: 50, width: 10, height: 18 };
	const below = HoverPositionCalculator.compute(anchor, viewport, { width: 200, height: 100 });
	assertEqual(below.placement, "below", "places below when there is room");
	assert(below.left >= 0 && below.left + 200 <= 600, "keeps hover inside viewport horizontally");
	const bottomAnchor = { x: 100, y: 380, width: 10, height: 18 };
	const above = HoverPositionCalculator.compute(bottomAnchor, viewport, { width: 200, height: 100 });
	assertEqual(above.placement, "above", "flips above when there is no room below");
	const rightEdge = { x: 580, y: 50, width: 10, height: 18 };
	const clamped = HoverPositionCalculator.compute(rightEdge, viewport, { width: 200, height: 100 });
	assert(clamped.left + 200 <= 600, "clamps to viewport right edge");
}

function testFoldingImports(): void {
	const model = makeModel("import { a } from 'a';\nimport { b } from 'b';\n\nconst x = 1;\n");
	const blocks = FoldingImports.computeImportBlocks(model);
	assertEqual(blocks.length, 1, "one import block detected");
	assertEqual(blocks[0].startLineNumber, 1, "block starts at first import");
	assertEqual(blocks[0].endLineNumber, 2, "block ends at last import");
	assertEqual(blocks[0].importCount, 2, "import count correct");
	const ranges = FoldingImports.computeFoldingRanges(model);
	assertEqual(ranges.length, 1, "one fold range produced");
	assertEqual(ranges[0].endLineNumber, 2, "fold range covers the block");
}

function testFoldingComments(): void {
	const model = makeModel("// c\n/* block one\n * more\n */\nconst x = 1;\n/** jsdoc\n * doc\n */\n");
	const blocks = FoldingComments.computeCommentBlocks(model);
	assertEqual(blocks.length, 2, "two block comments detected");
	assert(blocks[0].isJSDoc === false, "first block is not jsdoc");
	assert(blocks[1].isJSDoc === true, "second block is jsdoc");
	const ranges = FoldingComments.computeFoldingRanges(model);
	assertEqual(ranges.length, 2, "two comment fold ranges");
	assertEqual(ranges[0].isComment, true, "comment ranges flagged");
}

function testFindHistory(): void {
	const storage = new InMemoryStorageService();
	const history = new FindHistory(storage);
	history.push("alpha");
	history.push("beta");
	history.push("alpha");
	assertEqual(history.getLength(), 2, "deduplicates repeated queries");
	assertEqual(history.getMostRecent(), "alpha", "most recent first");
	assertEqual(history.undo(), "alpha", "undo returns most recent");
	assertEqual(history.undo(), "beta", "undo walks back through history");
	const fresh = new FindHistory(storage);
	assertEqual(fresh.getQueries().join(","), "alpha,beta", "history persisted through storage");
}

function testCodeLensCache(): void {
	const model = makeModel("const x = 1;\n");
	const cache = new CodeLensCache();
	const lens = {
		range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 },
		command: { id: "dc.test", title: "" }
	};
	const key = CodeLensCache.keyFor(model, lens);
	assert(cache.get(key) === null, "cache miss on first access");
	cache.markResolved(key, { ...lens, command: { id: "dc.test", title: "Run Test" } });
	const resolved = cache.getResolved(key);
	assert(resolved !== null, "resolved lens retrievable");
	assertEqual(resolved!.command.title, "Run Test", "resolved title cached");
	cache.invalidate(key);
	assert(cache.get(key) === null, "invalidation drops entry");
}

function testGhostTextModel(): void {
	const model = makeModel("const x = 1;\n");
	const ghost = new GhostTextModel();
	ghost.setModel(model);
	const updated = ghost.update({ insertText: ".map(x => x * 2)" }, { lineNumber: 2, column: 1 });
	assert(updated, "ghost text update accepted");
	assertEqual(ghost.getInsertText(), ".map(x => x * 2)", "insert text stored");
	ghost.reject();
	assert(!ghost.hasGhostText(), "reject clears ghost text");
	ghost.update({ insertText: ".map(fn)" }, { lineNumber: 2, column: 1 });
	const result = ghost.insert();
	assert(result !== null, "insert applies ghost text");
	assertEqual(result!.insertedText, ".map(fn)", "inserted text reported");
	assert(model.getLineContent(2).startsWith(".map(fn)"), "text inserted into document");
}

function testSuggestMemory(): void {
	const storage = new InMemoryStorageService();
	const memory = new SuggestMemory(storage);
	const item = makeItem("formatDocument", "format");
	memory.remember(item);
	memory.remember(item);
	assertEqual(memory.getEntryCount(), 1, "memory stores one entry");
	assertEqual(memory.getBoost(item), 18, "boost grows with usage count");
	const reloaded = new SuggestMemory(storage);
	assertEqual(reloaded.getEntryCount(), 1, "memory persisted through storage");
}

async function testWorkspaceSymbolProvider(): Promise<void> {
	const registry = new WorkspaceSymbolProviderRegistry();
	const provider = new IndexedWorkspaceSymbolProvider([
		{ name: "render", kind: 11, uri: URI.file("/a.ts"), range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 }, detail: "function" },
		{ name: "mount", kind: 11, uri: URI.file("/b.ts"), range: { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 5 }, detail: "function" }
	]);
	registry.register(provider);
	const result = await registry.search("ren");
	assertEqual(result.symbols.length, 1, "search finds matching symbol");
	assertEqual(result.symbols[0].name, "render", "correct symbol returned");
	assertEqual(result.providerCount, 1, "provider count reported");
}

function testCommitCharacters(): void {
	const item = makeItem("open", "");
	const host = {
		isSuggestionsVisible: () => true,
		getSelectedItem: () => item,
		acceptItem: () => undefined
	};
	const handler = new CommitCharactersHandler(host, [".", "("]);
	assert(handler.shouldCommit("."), "commit on dot");
	assert(handler.shouldCommit("("), "commit on paren");
	assert(!handler.shouldCommit("z"), "no commit on word character");
	const result = handler.handle(".");
	assertEqual(result.committed, true, "handle commits");
	assertEqual(result.remainingText, ".", "commit character preserved");
}

function testFoldingPersistence(): void {
	const storage = new InMemoryStorageService();
	const persistence = new FoldingPersistence(storage);
	const model = makeModel("function a() {\n  const x = 1;\n}\nfunction b() {\n  const y = 2;\n}\n", "/folding/test.ts");
	const foldingModel = new FoldingModel();
	foldingModel.setModel(model);
	foldingModel.collapse(1);
	foldingModel.collapse(4);
	persistence.save(foldingModel);
	assertEqual(persistence.getEntryCount(), 1, "state saved per resource");
	const restored = new FoldingPersistence(storage);
	const freshModel = new FoldingModel();
	freshModel.setModel(makeModel("function a() {\n  const x = 1;\n}\nfunction b() {\n  const y = 2;\n}\n", "/folding/test.ts"));
	const count = restored.restore(freshModel);
	assertEqual(count, 2, "collapsed regions restored");
}

/**
 * Runs the full contribution test suite without any framework: each test is
 * executed, failures are collected and a plain-text report is returned.
 */
export async function runContribSuite(): Promise<string> {
	const results = await Promise.all([
		run("suggest-sorting", testSuggestSorting),
		run("suggest-filter", testSuggestFilter),
		run("hover-position", testHoverPosition),
		run("folding-imports", testFoldingImports),
		run("folding-comments", testFoldingComments),
		run("find-history", testFindHistory),
		run("codelens-cache", testCodeLensCache),
		run("ghost-text-model", testGhostTextModel),
		run("suggest-memory", testSuggestMemory),
		run("workspace-symbol-provider", testWorkspaceSymbolProvider),
		run("suggest-commit-characters", testCommitCharacters),
		run("folding-persistence", testFoldingPersistence)
	]);

	const passed = results.filter(result => result.passed).length;
	const failed = results.length - passed;
	const lines = results.map(result =>
		`${result.passed ? "PASS" : "FAIL"} ${result.name} (${result.durationMs}ms)${result.error ? ` - ${result.error}` : ""}`
	);
	lines.push("");
	lines.push(`Contrib suite: ${passed}/${results.length} passed, ${failed} failed`);
	return lines.join("\n");
}

export function runContribSuiteSync(): string {
	void runContribSuite();
	return "Contrib suite started (async).";
}

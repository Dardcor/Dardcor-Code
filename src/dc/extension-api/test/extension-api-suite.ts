import { Position, Range, WorkspaceEdit } from '../api/ext-host-api-impl.js';
import {
	apiPositionToLspPosition,
	lspPositionToApiPosition,
	apiRangeToLspRange,
	lspRangeToApiRange,
	lspWorkspaceEditToApiEdit,
	ILspWorkspaceEdit,
	ILspTextEdit
} from '../lsp/lsp-converters.js';
import { buildClientCapabilities } from '../lsp/lsp-client-capabilities.js';
import { buildWebviewCsp } from '../sandbox/webview-csp.js';
import { CustomEditorModel } from '../sandbox/custom-editor-model.js';
import { LspWorkspaceEdits } from '../lsp/lsp-workspace-edits.js';

export interface IExtensionApiSuiteResult {
	pass: number;
	fail: number;
}

export class ExtensionApiSuite {
	public static async run(): Promise<IExtensionApiSuiteResult> {
		const suite = new ExtensionApiSuite();
		await suite.testLspConverters();
		suite.testClientCapabilities();
		suite.testWebviewCsp();
		suite.testCustomEditorModel();
		suite.testWorkspaceEdits();
		return { pass: suite._pass, fail: suite._fail };
	}

	private _pass = 0;
	private _fail = 0;

	private _check(name: string, condition: boolean): void {
		if (condition) {
			this._pass++;
		} else {
			this._fail++;
			console.error(`[extension-api-suite] FAIL: ${name}`);
		}
	}

	private _checkEqual(name: string, actual: unknown, expected: unknown): void {
		const actualJson = JSON.stringify(actual);
		const expectedJson = JSON.stringify(expected);
		this._check(`${name} (diharapkan ${expectedJson})`, actualJson === expectedJson);
	}

	private async testLspConverters(): Promise<void> {
		const position = new Position(2, 3);
		const lspPosition = apiPositionToLspPosition(position);
		this._checkEqual('lsp-converters: position ke LSP', lspPosition, { line: 1, character: 2 });
		const roundTripPosition = lspPositionToApiPosition(lspPosition);
		this._check('lsp-converters: round trip posisi', roundTripPosition.lineNumber === 2 && roundTripPosition.column === 3);

		const range = new Range(1, 1, 2, 5);
		const lspRange = apiRangeToLspRange(range);
		this._checkEqual('lsp-converters: range ke LSP', lspRange, {
			start: { line: 0, character: 0 },
			end: { line: 1, character: 4 }
		});
		const roundTripRange = lspRangeToApiRange(lspRange);
		this._check(
			'lsp-converters: round trip range',
			roundTripRange.start.lineNumber === 1 && roundTripRange.start.column === 1 &&
			roundTripRange.end.lineNumber === 2 && roundTripRange.end.column === 5
		);

		const textEdit: ILspTextEdit = { range: lspRange, newText: 'abc' };
		const workspaceEdit: ILspWorkspaceEdit = {
			changes: {
				'file:///a.ts': [textEdit],
				'file:///b.ts': [
					{ range: { start: { line: 2, character: 0 }, end: { line: 2, character: 2 } }, newText: 'xy' }
				]
			}
		};
		const converted = lspWorkspaceEditToApiEdit(workspaceEdit);
		const entries = converted.entries();
		this._check(
			'lsp-converters: workspace edit ke API',
			entries.length === 2 && entries[0][1].length === 1 && entries[1][1].length === 1
		);
		this._check(
			'lsp-converters: workspace edit is WorkspaceEdit',
			converted instanceof WorkspaceEdit
		);
	}

	private testClientCapabilities(): void {
		const capabilities = buildClientCapabilities();
		const textDocument = capabilities.textDocument as Record<string, unknown> | undefined;
		this._check('client-capabilities: textDocument ada', !!textDocument);
		this._check('client-capabilities: completion', !!(textDocument as any)?.completion);
		this._check('client-capabilities: hover', !!(textDocument as any)?.hover);
		this._check('client-capabilities: signatureHelp', !!(textDocument as any)?.signatureHelp);
		this._check('client-capabilities: definition', !!(textDocument as any)?.definition);
		this._check('client-capabilities: references', !!(textDocument as any)?.references);
		this._check('client-capabilities: rename', !!(textDocument as any)?.rename);
		this._check('client-capabilities: formatting', !!(textDocument as any)?.formatting);
		this._check('client-capabilities: codeActionLiteralSupport', !!(textDocument as any)?.codeAction?.codeActionLiteralSupport);
		this._check('client-capabilities: semanticTokens', !!(textDocument as any)?.semanticTokens);
		this._check('client-capabilities: inlayHint', !!(textDocument as any)?.inlayHint);
		this._check('client-capabilities: foldingRange', !!(textDocument as any)?.foldingRange);
		this._check('client-capabilities: documentSymbol', !!(textDocument as any)?.documentSymbol);
		this._check('client-capabilities: documentLink', !!(textDocument as any)?.documentLink);
		this._check('client-capabilities: codeLens', !!(textDocument as any)?.codeLens);
		this._check('client-capabilities: callHierarchy', !!(textDocument as any)?.callHierarchy);
		this._check('client-capabilities: typeHierarchy', !!(textDocument as any)?.typeHierarchy);
		this._check('client-capabilities: selectionRange', !!(textDocument as any)?.selectionRange);
		this._check('client-capabilities: workspace', !!(capabilities.workspace as any)?.applyEdit === true);
	}

	private testWebviewCsp(): void {
		const source = 'https://webview-123.vscode-webview.net';
		const restricted = buildWebviewCsp(source, { allowScripts: false });
		this._check('webview-csp: default-src none', restricted.includes("default-src 'none'"));
		this._check('webview-csp: script-src none', restricted.includes("script-src 'none'"));
		this._check('webview-csp: style unsafe-inline', restricted.includes("style-src 'unsafe-inline'"));
		this._check('webview-csp: img data https', restricted.includes('img-src data: https:'));
		this._check('webview-csp: connect ws https', restricted.includes('connect-src ws: https:'));

		const scripted = buildWebviewCsp(source, { allowScripts: true, allowEval: true });
		this._check('webview-csp: script-src sumber', scripted.includes(`script-src ${source}`));
		this._check('webview-csp: unsafe-eval', scripted.includes("'unsafe-eval'"));
		this._check('webview-csp: tidak ada script-src none', !scripted.includes("script-src 'none'"));
		this._check('webview-csp: frame-src sumber', scripted.includes(`frame-src ${source}`));
	}

	private testCustomEditorModel(): void {
		const model = new CustomEditorModel('hello world');
		let changeCount = 0;
		const subscription = model.onDidChangeContent(() => {
			changeCount++;
		});
		model.applyEdit({ start: 0, end: 5, text: 'goodbye' });
		this._check('custom-editor-model: applyEdit', model.getContent() === 'goodbye world' && changeCount === 1);
		model.undo();
		this._check('custom-editor-model: undo', model.getContent() === 'hello world' && changeCount === 2);
		model.redo();
		this._check('custom-editor-model: redo', model.getContent() === 'goodbye world' && changeCount === 3);
		model.markDirty();
		this._check('custom-editor-model: markDirty', model.isDirty === true);
		model.save('tersimpan');
		this._check('custom-editor-model: save', model.getContent() === 'tersimpan' && model.isDirty === false);
		subscription.dispose();
	}

	private testWorkspaceEdits(): void {
		const workspaceEdits = new LspWorkspaceEdits();
		const applied: string[] = [];
		const edit: ILspWorkspaceEdit = {
			changes: {
				'file:///a.ts': [
					{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'abc' }
				]
			},
			documentChanges: [
				{
					textDocument: { uri: 'file:///b.ts' },
					edits: [
						{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } }, newText: 'x' }
					]
				},
				{ kind: 'create', uri: 'file:///c.ts', options: {} }
			]
		};
		workspaceEdits.applyWorkspaceEdit(edit, (uri, edits) => {
			applied.push(`${uri}:${edits.length}`);
		});
		this._checkEqual('workspace-edits: interpretasi', applied, ['file:///a.ts:1', 'file:///b.ts:1']);
	}
}

export function runExtensionApiSuite(): Promise<IExtensionApiSuiteResult> {
	return ExtensionApiSuite.run();
}

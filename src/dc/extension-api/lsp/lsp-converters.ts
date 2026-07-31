/**
 * Dardcor Code - LSP to Editor Internal Data Type Converters (Task 615)
 * Mirrors: vs/workbench/api/common/languageFeatures.ts (converters)
 */

import { Position as EditorPosition, Range as EditorRange } from '../../engine/model/text-model';
import { Position, Range, Location, Diagnostic, DiagnosticSeverity, MarkdownString, TextEdit, WorkspaceEdit } from '../api/ext-host-api-impl';
import { URI } from '../../core/types/uri';

export interface ILspPosition {
	line: number;
	character: number;
}

export interface ILspRange {
	start: ILspPosition;
	end: ILspPosition;
}

export interface ILspDiagnostic {
	range: ILspRange;
	severity?: number;
	code?: string | number;
	codeDescription?: { href: string };
	source?: string;
	message: string;
	relatedInformation?: Array<{ location: { uri: string; range: ILspRange }; message: string }>;
}

export interface ILspLocation {
	uri: string;
	range: ILspRange;
}

export interface ILspMarkupContent {
	kind: 'plaintext' | 'markdown';
	value: string;
}

export interface ILspTextEdit {
	range: ILspRange;
	newText: string;
}

export interface ILspWorkspaceEdit {
	changes?: Record<string, ILspTextEdit[]>;
	documentChanges?: Array<{
		textDocument?: { uri: string; version?: number | null };
		edits?: ILspTextEdit[];
		kind?: 'create' | 'rename' | 'delete';
		uri?: string;
		options?: Record<string, unknown>;
	}>;
}

export function lspPositionToEditorPosition(lsp: ILspPosition): EditorPosition {
	return new EditorPosition(lsp.line + 1, lsp.character + 1);
}

export function editorPositionToLspPosition(editor: EditorPosition | Position): ILspPosition {
	return { line: editor.lineNumber - 1, character: editor.column - 1 };
}

export function lspRangeToEditorRange(lsp: ILspRange): EditorRange {
	return new EditorRange(
		lsp.start.line + 1,
		lsp.start.character + 1,
		lsp.end.line + 1,
		lsp.end.character + 1
	);
}

export function editorRangeToLspRange(editor: EditorRange | Range): ILspRange {
	if ('startLineNumber' in editor) {
		return {
			start: { line: editor.startLineNumber - 1, character: editor.startColumn - 1 },
			end: { line: editor.endLineNumber - 1, character: editor.endColumn - 1 }
		};
	} else {
		return {
			start: { line: editor.start.lineNumber - 1, character: editor.start.column - 1 },
			end: { line: editor.end.lineNumber - 1, character: editor.end.column - 1 }
		};
	}
}

export function lspPositionToApiPosition(lsp: ILspPosition): Position {
	return new Position(lsp.line + 1, lsp.character + 1);
}

export function apiPositionToLspPosition(position: Position): ILspPosition {
	return { line: position.lineNumber - 1, character: position.column - 1 };
}

export function lspRangeToApiRange(lsp: ILspRange): Range {
	return new Range(lspRangeToEditorRange(lsp).startLineNumber, lspRangeToEditorRange(lsp).startColumn, lspRangeToEditorRange(lsp).endLineNumber, lspRangeToEditorRange(lsp).endColumn);
}

export function apiRangeToLspRange(range: Range): ILspRange {
	return editorRangeToLspRange(range);
}

export function lspDiagnosticToApiDiagnostic(lsp: ILspDiagnostic, uri: URI): Diagnostic {
	const severity = lsp.severity === undefined
		? DiagnosticSeverity.Error
		: Math.min(Math.max(lsp.severity, 0), 3) as DiagnosticSeverity;
	return new Diagnostic(
		lspRangeToApiRange(lsp.range),
		lsp.message,
		severity,
		lsp.code,
		lsp.source,
		(lsp.relatedInformation ?? []).map(info => ({
			location: new Location(URI.parse(info.location.uri), lspRangeToApiRange(info.location.range)),
			message: info.message
		}))
	);
}

export function lspLocationToApiLocation(lsp: ILspLocation): Location {
	return new Location(URI.parse(lsp.uri), lspRangeToApiRange(lsp.range));
}

export function lspMarkupContentToMarkdown(content: ILspMarkupContent | string | undefined): MarkdownString | undefined {
	if (content === undefined) {
		return undefined;
	}
	if (typeof content === 'string') {
		return new MarkdownString(content);
	}
	if (content.kind === 'markdown') {
		return new MarkdownString(content.value);
	}
	return new MarkdownString(content.value.replace(/[`*_]/g, '').replace(/\n/g, '  \n'));
}

export function lspWorkspaceEditToApiEdit(lsp: ILspWorkspaceEdit): WorkspaceEdit {
	const edit = new WorkspaceEdit();
	for (const [uri, textEdits] of Object.entries(lsp.changes ?? {})) {
		edit.set(URI.parse(uri), textEdits.map(te => new TextEdit(lspRangeToApiRange(te.range), te.newText)));
	}
	return edit;
}

export function apiWorkspaceEditToLspEdit(edit: WorkspaceEdit): ILspWorkspaceEdit {
	const changes: Record<string, ILspTextEdit[]> = {};
	for (const [uri, textEdits] of edit.entries()) {
		changes[uri.toString()] = textEdits.map(te => ({
			range: apiRangeToLspRange(te.range),
			newText: te.newText
		}));
	}
	return { changes };
}

export function toLspDiagnosticSeverity(severity: DiagnosticSeverity): number {
	switch (severity) {
		case DiagnosticSeverity.Error:
			return 1;
		case DiagnosticSeverity.Warning:
			return 2;
		case DiagnosticSeverity.Information:
			return 3;
		case DiagnosticSeverity.Hint:
			return 4;
		default:
			return 1;
	}
}

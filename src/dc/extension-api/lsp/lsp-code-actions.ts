import { IDisposable, toDisposable } from '../../core/lifecycle/disposable';
import { LspClient } from './lsp-client';
import { ILspPosition, ILspRange, ILspDiagnostic } from './lsp-converters';
import { Range } from '../api/ext-host-api-impl';

export interface ICodeActionContext {
	diagnostics: ILspDiagnostic[];
	only?: string[];
	triggerKind?: number;
}

export interface CodeAction {
	title: string;
	kind?: string;
	diagnostics?: ILspDiagnostic[];
	edit?: ILspWorkspaceEditShape;
	command?: { title: string; command: string; arguments?: unknown[] };
	isPreferred?: boolean;
	disabled?: { reason: string };
	data?: unknown;
}

export interface ILspWorkspaceEditShape {
	changes?: Record<string, Array<{ range: ILspRange; newText: string }>>;
	documentChanges?: Array<{
		textDocument?: { uri: string; version?: number | null };
		edits?: Array<{ range: ILspRange; newText: string }>;
		kind?: 'create' | 'rename' | 'delete';
		uri?: string;
		options?: Record<string, unknown>;
	}>;
}

export class LspCodeActions {
	private _client: LspClient | undefined;

	public register(client: LspClient): IDisposable {
		this._client = client;
		return toDisposable(() => {
			if (this._client === client) {
				this._client = undefined;
			}
		});
	}

	public async getCodeActions(uri: string, range: Range | ILspRange, context: ICodeActionContext): Promise<CodeAction[]> {
		const result = await this._requireClient().request<CodeAction[] | null>('textDocument/codeAction', {
			textDocument: { uri },
			range: this._toLspRange(range),
			context: {
				diagnostics: context.diagnostics,
				only: context.only,
				triggerKind: context.triggerKind
			}
		});
		return result ?? [];
	}

	public async executeCodeAction(action: CodeAction): Promise<unknown> {
		if (!action.command) {
			return undefined;
		}
		return this._requireClient().request('workspace/executeCommand', {
			command: action.command.command,
			arguments: action.command.arguments ?? []
		});
	}

	private _requireClient(): LspClient {
		if (!this._client) {
			throw new Error('LSP client belum diregistrasi');
		}
		return this._client;
	}

	private _toLspRange(range: Range | ILspRange): ILspRange {
		const candidate = range as ILspRange;
		if (candidate.start && typeof candidate.start.line === 'number') {
			return candidate;
		}
		const apiRange = range as Range;
		return {
			start: { line: apiRange.start.lineNumber - 1, character: apiRange.start.column - 1 },
			end: { line: apiRange.end.lineNumber - 1, character: apiRange.end.column - 1 }
		};
	}
}

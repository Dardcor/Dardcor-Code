import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { IPosition, IRange } from '../model/text-model';

export type CodeActionKind = 'quickfix' | 'refactor' | 'refactor.extract' | 'refactor.inline' | 'refactor.rewrite' | 'source' | 'source.organizeImports' | 'source.fixAll' | 'empty';

export interface CodeAction {
	readonly title: string;
	readonly kind?: CodeActionKind;
	readonly description?: string;
	readonly edit?: { readonly range: IRange; readonly text: string };
	readonly commandId?: string;
	readonly diagnostics?: readonly { readonly message: string; readonly severity: string }[];
	readonly isPreferred?: boolean;
}

export interface ICodeActionProvider {
	(position: IPosition): CodeAction[];
}

export class CodeActionController extends Disposable {
	private _provider: ICodeActionProvider | null = null;
	private _cachedPosition: IPosition | null = null;
	private _cachedActions: CodeAction[] | null = null;

	private readonly _onDidChangeAvailableActions = this._register(new Emitter<CodeAction[]>());
	readonly onDidChangeAvailableActions: Event<CodeAction[]> = this._onDidChangeAvailableActions.event;

	public setProvider(provider: ICodeActionProvider | null): void {
		this._provider = provider;
		this._cachedPosition = null;
		this._cachedActions = null;
		this._onDidChangeAvailableActions.fire([]);
	}

	public getProvider(): ICodeActionProvider | null {
		return this._provider;
	}

	public getActionsAtPosition(position: IPosition): CodeAction[] {
		if (!this._provider) {
			return [];
		}
		if (this._cachedPosition && this._cachedPosition.lineNumber === position.lineNumber && this._cachedPosition.column === position.column && this._cachedActions) {
			return this._cachedActions;
		}
		const actions = this._provider(position) ?? [];
		this._cachedPosition = { lineNumber: position.lineNumber, column: position.column };
		this._cachedActions = actions;
		return actions;
	}

	public invalidateCache(): void {
		this._cachedPosition = null;
		this._cachedActions = null;
	}

	public hasActionsAtPosition(position: IPosition): boolean {
		return this.getActionsAtPosition(position).length > 0;
	}

	public getPreferredAction(position: IPosition): CodeAction | undefined {
		return this.getActionsAtPosition(position).find(action => action.isPreferred);
	}

	public getActionsByKind(position: IPosition, kind: CodeActionKind): CodeAction[] {
		return this.getActionsAtPosition(position).filter(action => action.kind === kind);
	}

	public getQuickFixes(position: IPosition): CodeAction[] {
		return this.getActionsAtPosition(position).filter(action => !action.kind || action.kind === 'quickfix' || action.kind.startsWith('source.'));
	}

	public hasProvider(): boolean {
		return this._provider !== null;
	}
}

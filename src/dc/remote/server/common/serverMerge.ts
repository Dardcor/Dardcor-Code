import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerMergeInput {
	readonly uri: string;
	readonly title: string;
	readonly detail?: string;
}

export interface IServerMergeConflict {
	readonly range: { startLine: number; endLine: number };
	readonly current: { content: string; name: string };
	readonly incoming: { content: string; name: string };
	readonly commonAncestor?: { content: string };
}

export interface IServerMergeEditorService {
	readonly onDidOpenMergeEditor: Event<{ base: string; input1: IServerMergeInput; input2: IServerMergeInput; result: string }>;
	readonly onDidCloseMergeEditor: Event<string>;
	readonly onDidCompleteMerge: Event<{ result: string; accepted: boolean }>;
	openMergeEditor(base: string, input1: IServerMergeInput, input2: IServerMergeInput, result: string): void;
	closeMergeEditor(result: string): void;
	getConflicts(uri: string): IServerMergeConflict[];
	acceptCurrentChange(uri: string, conflictIndex: number): void;
	acceptIncomingChange(uri: string, conflictIndex: number): void;
	acceptBothChanges(uri: string, conflictIndex: number): void;
	completeMerge(result: string, accepted: boolean): void;
	isMergeEditorOpen(uri: string): boolean;
}

export class ServerMergeCommon implements IServerMergeEditorService {
	private readonly _openEditors = new Set<string>();
	private readonly _conflicts = new Map<string, IServerMergeConflict[]>();

	private readonly _onDidOpenMergeEditor = new Emitter<{ base: string; input1: IServerMergeInput; input2: IServerMergeInput; result: string }>();
	readonly onDidOpenMergeEditor = this._onDidOpenMergeEditor.event;

	private readonly _onDidCloseMergeEditor = new Emitter<string>();
	readonly onDidCloseMergeEditor = this._onDidCloseMergeEditor.event;

	private readonly _onDidCompleteMerge = new Emitter<{ result: string; accepted: boolean }>();
	readonly onDidCompleteMerge = this._onDidCompleteMerge.event;

	openMergeEditor(base: string, input1: IServerMergeInput, input2: IServerMergeInput, result: string): void {
		this._openEditors.add(result);
		this._onDidOpenMergeEditor.fire({ base, input1, input2, result });
	}

	closeMergeEditor(result: string): void {
		this._openEditors.delete(result);
		this._conflicts.delete(result);
		this._onDidCloseMergeEditor.fire(result);
	}

	getConflicts(uri: string): IServerMergeConflict[] {
		return this._conflicts.get(uri) || [];
	}

	acceptCurrentChange(uri: string, conflictIndex: number): void {
		const conflicts = this._conflicts.get(uri);
		if (conflicts && conflictIndex < conflicts.length) {
			conflicts.splice(conflictIndex, 1);
		}
	}

	acceptIncomingChange(uri: string, conflictIndex: number): void {
		const conflicts = this._conflicts.get(uri);
		if (conflicts && conflictIndex < conflicts.length) {
			conflicts.splice(conflictIndex, 1);
		}
	}

	acceptBothChanges(uri: string, conflictIndex: number): void {
		const conflicts = this._conflicts.get(uri);
		if (conflicts && conflictIndex < conflicts.length) {
			conflicts.splice(conflictIndex, 1);
		}
	}

	completeMerge(result: string, accepted: boolean): void {
		this._openEditors.delete(result);
		this._conflicts.delete(result);
		this._onDidCompleteMerge.fire({ result, accepted });
	}

	isMergeEditorOpen(uri: string): boolean {
		return this._openEditors.has(uri);
	}
}

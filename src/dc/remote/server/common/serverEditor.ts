import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerEditorInput {
	readonly resource: string;
	readonly name: string;
	readonly description?: string;
	readonly encoding?: string;
	readonly languageId?: string;
}

export interface IServerEditorGroup {
	readonly id: number;
	readonly label: string;
	readonly editors: IServerEditorInput[];
	readonly activeEditor: IServerEditorInput | undefined;
	readonly isActive: boolean;
}

export interface IServerEditorService {
	readonly onDidActiveEditorChange: Event<IServerEditorInput | undefined>;
	readonly onDidOpenEditor: Event<IServerEditorInput>;
	readonly onDidCloseEditor: Event<IServerEditorInput>;
	readonly onDidChangeGroup: Event<IServerEditorGroup>;
	openEditor(input: IServerEditorInput, groupId?: number): void;
	closeEditor(input: IServerEditorInput, groupId?: number): void;
	getActiveEditor(): IServerEditorInput | undefined;
	getEditors(groupId?: number): IServerEditorInput[];
	getGroups(): IServerEditorGroup[];
	getActiveGroup(): IServerEditorGroup | undefined;
	moveEditor(input: IServerEditorInput, fromGroupId: number, toGroupId: number): void;
	splitEditor(input: IServerEditorInput, direction: 'left' | 'right' | 'up' | 'down'): void;
	closeAllEditors(groupId?: number): void;
	saveEditor(input: IServerEditorInput): Promise<boolean>;
	saveAllEditors(): Promise<boolean>;
	isEditorDirty(input: IServerEditorInput): boolean;
}

export class ServerEditorCommon implements IServerEditorService {
	private readonly _groups: IServerEditorGroup[] = [{ id: 1, label: 'Group 1', editors: [], activeEditor: undefined, isActive: true }];
	private _activeEditor: IServerEditorInput | undefined;

	private readonly _onDidActiveEditorChange = new Emitter<IServerEditorInput | undefined>();
	readonly onDidActiveEditorChange: Event<IServerEditorInput | undefined> = this._onDidActiveEditorChange.event;

	private readonly _onDidOpenEditor = new Emitter<IServerEditorInput>();
	readonly onDidOpenEditor: Event<IServerEditorInput> = this._onDidOpenEditor.event;

	private readonly _onDidCloseEditor = new Emitter<IServerEditorInput>();
	readonly onDidCloseEditor: Event<IServerEditorInput> = this._onDidCloseEditor.event;

	private readonly _onDidChangeGroup = new Emitter<IServerEditorGroup>();
	readonly onDidChangeGroup: Event<IServerEditorGroup> = this._onDidChangeGroup.event;

	openEditor(input: IServerEditorInput, groupId?: number): void {
		const group = this._findGroup(groupId);
		if (group) {
			const existing = group.editors.find(e => e.resource === input.resource);
			if (!existing) {
				(group.editors as IServerEditorInput[]).push(input);
			}
			(group as any).activeEditor = input;
			this._activeEditor = input;
			this._onDidOpenEditor.fire(input);
			this._onDidActiveEditorChange.fire(input);
			this._onDidChangeGroup.fire(group);
		}
	}

	closeEditor(input: IServerEditorInput, groupId?: number): void {
		const group = this._findGroup(groupId);
		if (group) {
			const idx = group.editors.findIndex(e => e.resource === input.resource);
			if (idx >= 0) {
				(group.editors as IServerEditorInput[]).splice(idx, 1);
				if (group.activeEditor?.resource === input.resource) {
					(group as any).activeEditor = group.editors[Math.max(0, idx - 1)] || undefined;
				}
				this._onDidCloseEditor.fire(input);
				this._onDidChangeGroup.fire(group);
				if (this._activeEditor?.resource === input.resource) {
					this._activeEditor = group.activeEditor;
					this._onDidActiveEditorChange.fire(this._activeEditor);
				}
			}
		}
	}

	getActiveEditor(): IServerEditorInput | undefined {
		return this._activeEditor;
	}

	getEditors(groupId?: number): IServerEditorInput[] {
		const group = this._findGroup(groupId);
		return group ? [...group.editors] : [];
	}

	getGroups(): IServerEditorGroup[] {
		return [...this._groups];
	}

	getActiveGroup(): IServerEditorGroup | undefined {
		return this._groups.find(g => g.isActive);
	}

	moveEditor(input: IServerEditorInput, fromGroupId: number, toGroupId: number): void {
		this.closeEditor(input, fromGroupId);
		this.openEditor(input, toGroupId);
	}

	splitEditor(input: IServerEditorInput, direction: 'left' | 'right' | 'up' | 'down'): void {
		const newId = Math.max(...this._groups.map(g => g.id)) + 1;
		const newGroup: IServerEditorGroup = { id: newId, label: `Group ${newId}`, editors: [input], activeEditor: input, isActive: false };
		this._groups.push(newGroup);
		this._onDidChangeGroup.fire(newGroup);
	}

	closeAllEditors(groupId?: number): void {
		const group = this._findGroup(groupId);
		if (group) {
			const editors = [...group.editors];
			for (const editor of editors) {
				this.closeEditor(editor, group.id);
			}
		}
	}

	async saveEditor(input: IServerEditorInput): Promise<boolean> {
		return true;
	}

	async saveAllEditors(): Promise<boolean> {
		return true;
	}

	isEditorDirty(_input: IServerEditorInput): boolean {
		return false;
	}

	private _findGroup(groupId?: number): IServerEditorGroup | undefined {
		if (groupId !== undefined) {
			return this._groups.find(g => g.id === groupId);
		}
		return this.getActiveGroup() || this._groups[0];
	}
}

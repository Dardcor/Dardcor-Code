/**
 * Dardcor Code - Workspace Context Service (Task 133)
 */

import { createDecorator } from '../instantiation/annotations';
import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';
import { URI } from '../../core/types/uri';
import { IWorkspaceFolder, WorkspaceFolder } from './workspace-folder';

export type { IWorkspaceFolder } from './workspace-folder';

export type WorkbenchState = 'empty' | 'folder' | 'workspace';

export interface IWorkspace {
	readonly id: string;
	readonly name: string;
	readonly configuration: URI | null;
	readonly folders: readonly IWorkspaceFolder[];
}

export interface IWorkspaceContextService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeWorkspaceFolders: Event<void>;
	readonly onDidChangeWorkbenchState: Event<void>;
	getWorkspace(): IWorkspace;
	getWorkbenchState(): WorkbenchState;
	getWorkspaceFolder(resource: URI): IWorkspaceFolder | undefined;
	getWorkspaceFolderIndex(folder: IWorkspaceFolder): number;
	isInsideWorkspace(resource: URI): boolean;
	hasWorkspaceFolders(): boolean;
	setWorkspace(workspace: IWorkspace): void;
}

export const IWorkspaceContextService = createDecorator<IWorkspaceContextService>('workspaceContextService');

export function createEmptyWorkspace(): IWorkspace {
	return { id: '', name: 'Untitled', configuration: null, folders: [] };
}

export function createSingleFolderWorkspace(folderUri: URI, name?: string): IWorkspace {
	const folder = new WorkspaceFolder(folderUri, name, 0);
	return {
		id: folderUri.toString(),
		name: folder.name,
		configuration: folderUri,
		folders: [folder]
	};
}

export function createMultiFolderWorkspace(folders: readonly URI[], configuration?: URI | null): IWorkspace {
	return {
		id: configuration?.toString() ?? 'multi-root',
		name: configuration ? 'Multi-root Workspace' : 'Untitled Workspace',
		configuration: configuration ?? null,
		folders: folders.map((uri, index) => new WorkspaceFolder(uri, undefined, index))
	};
}

export class WorkspaceService extends Disposable implements IWorkspaceContextService {
	declare readonly _serviceBrand: undefined;

	private _workspace: IWorkspace;
	private _workbenchState: WorkbenchState;

	private readonly _onDidChangeWorkspaceFolders = this._register(new Emitter<void>());
	readonly onDidChangeWorkspaceFolders = this._onDidChangeWorkspaceFolders.event;

	private readonly _onDidChangeWorkbenchState = this._register(new Emitter<void>());
	readonly onDidChangeWorkbenchState = this._onDidChangeWorkbenchState.event;

	constructor(workspace: IWorkspace | null = null) {
		super();
		this._workspace = workspace ?? createEmptyWorkspace();
		this._workbenchState = this._computeState(this._workspace);
	}

	public getWorkspace(): IWorkspace {
		return this._workspace;
	}

	public getWorkbenchState(): WorkbenchState {
		return this._workbenchState;
	}

	public getWorkspaceFolder(resource: URI): IWorkspaceFolder | undefined {
		let best: IWorkspaceFolder | undefined;
		let bestLength = -1;
		for (const folder of this._workspace.folders) {
			const folderPath = folder.uri.path;
			const resourcePath = resource.path;
			const matches = resourcePath === folderPath || resourcePath.startsWith(folderPath + '/');
			if (matches && folderPath.length > bestLength) {
				best = folder;
				bestLength = folderPath.length;
			}
		}
		return best;
	}

	public getWorkspaceFolderIndex(folder: IWorkspaceFolder): number {
		return this._workspace.folders.findIndex((f) => f.uri.toString() === folder.uri.toString());
	}

	public isInsideWorkspace(resource: URI): boolean {
		return this.getWorkspaceFolder(resource) !== undefined;
	}

	public hasWorkspaceFolders(): boolean {
		return this._workspace.folders.length > 0;
	}

	public setWorkspace(workspace: IWorkspace): void {
		const oldState = this._workbenchState;
		this._workspace = workspace;
		this._workbenchState = this._computeState(workspace);
		if (this._workbenchState !== oldState) {
			this._onDidChangeWorkbenchState.fire();
		}
		this._onDidChangeWorkspaceFolders.fire();
	}

	private _computeState(workspace: IWorkspace): WorkbenchState {
		if (workspace.folders.length > 1) {
			return 'workspace';
		}
		if (workspace.folders.length === 1) {
			return 'folder';
		}
		return 'empty';
	}
}

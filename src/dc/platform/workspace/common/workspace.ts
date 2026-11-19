/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { Event } from '../../../base/common/event.js';
import { basename, extname } from '../../../base/common/path.js';
import { TernarySearchTree } from '../../../base/common/ternarySearchTree.js';
import { extname as resourceExtname, basenameOrAuthority, joinPath, extUriBiasedIgnorePathCase } from '../../../base/common/resources.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IEnvironmentService } from '../../environment/common/environment.js';
import { Schemas } from '../../../base/common/network.js';

export const IWorkspaceContextService = createDecorator<IWorkspaceContextService>('contextService');

export interface IWorkspaceContextService {

	readonly _serviceBrand: undefined;

	readonly onDidChangeWorkbenchState: Event<WorkbenchState>;

	readonly onDidChangeWorkspaceName: Event<void>;

	readonly onWillChangeWorkspaceFolders: Event<IWorkspaceFoldersWillChangeEvent>;

	readonly onDidChangeWorkspaceFolders: Event<IWorkspaceFoldersChangeEvent>;

	getCompleteWorkspace(): Promise<IWorkspace>;

	getWorkspace(): IWorkspace;

	getWorkbenchState(): WorkbenchState;

	getWorkspaceFolder(resource: URI): IWorkspaceFolder | null;

	isCurrentWorkspace(workspaceIdOrFolder: IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | URI): boolean;

	isInsideWorkspace(resource: URI): boolean;

	hasWorkspaceData(): boolean;
}

export interface IResolvedWorkspace extends IWorkspaceIdentifier, IBaseWorkspace {
	readonly folders: IWorkspaceFolder[];
}

export interface IBaseWorkspace {

	readonly remoteAuthority?: string;

	readonly transient?: boolean;
}

export interface IBaseWorkspaceIdentifier {

	readonly id: string;
}

export interface ISingleFolderWorkspaceIdentifier extends IBaseWorkspaceIdentifier {

	readonly uri: URI;
}

export interface IWorkspaceIdentifier extends IBaseWorkspaceIdentifier {

	configPath: URI;
}

export interface IEmptyWorkspaceIdentifier extends IBaseWorkspaceIdentifier { }

export type IAnyWorkspaceIdentifier = IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | IEmptyWorkspaceIdentifier;

export function isSingleFolderWorkspaceIdentifier(obj: unknown): obj is ISingleFolderWorkspaceIdentifier {
	const singleFolderIdentifier = obj as ISingleFolderWorkspaceIdentifier | undefined;

	return typeof singleFolderIdentifier?.id === 'string' && URI.isUri(singleFolderIdentifier.uri);
}

export function isEmptyWorkspaceIdentifier(obj: unknown): obj is IEmptyWorkspaceIdentifier {
	const emptyWorkspaceIdentifier = obj as IEmptyWorkspaceIdentifier | undefined;
	return typeof emptyWorkspaceIdentifier?.id === 'string'
		&& !isSingleFolderWorkspaceIdentifier(obj)
		&& !isWorkspaceIdentifier(obj);
}

export const EXTENSION_DEVELOPMENT_EMPTY_WINDOW_WORKSPACE: IEmptyWorkspaceIdentifier = { id: 'ext-dev' };
export const UNKNOWN_EMPTY_WINDOW_WORKSPACE: IEmptyWorkspaceIdentifier = { id: 'empty-window' };

export function toWorkspaceIdentifier(workspace: IWorkspace): IAnyWorkspaceIdentifier;
export function toWorkspaceIdentifier(backupPath: string | undefined, isExtensionDevelopment: boolean): IEmptyWorkspaceIdentifier;
export function toWorkspaceIdentifier(arg0: IWorkspace | string | undefined, isExtensionDevelopment?: boolean): IAnyWorkspaceIdentifier {

	if (typeof arg0 === 'string' || typeof arg0 === 'undefined') {

		if (typeof arg0 === 'string') {
			return {
				id: basename(arg0)
			};
		}

		if (isExtensionDevelopment) {
			return EXTENSION_DEVELOPMENT_EMPTY_WINDOW_WORKSPACE;
		}

		return UNKNOWN_EMPTY_WINDOW_WORKSPACE;
	}

	const workspace = arg0;
	if (workspace.configuration) {
		return {
			id: workspace.id,
			configPath: workspace.configuration
		};
	}

	if (workspace.folders.length === 1) {
		return {
			id: workspace.id,
			uri: workspace.folders[0].uri
		};
	}

	return {
		id: workspace.id
	};
}

export function isWorkspaceIdentifier(obj: unknown): obj is IWorkspaceIdentifier {
	const workspaceIdentifier = obj as IWorkspaceIdentifier | undefined;

	return typeof workspaceIdentifier?.id === 'string' && URI.isUri(workspaceIdentifier.configPath);
}

export interface ISerializedSingleFolderWorkspaceIdentifier extends IBaseWorkspaceIdentifier {
	readonly uri: UriComponents;
}

export interface ISerializedWorkspaceIdentifier extends IBaseWorkspaceIdentifier {
	readonly configPath: UriComponents;
}

export function reviveIdentifier(identifier: undefined): undefined;
export function reviveIdentifier(identifier: ISerializedWorkspaceIdentifier): IWorkspaceIdentifier;
export function reviveIdentifier(identifier: ISerializedSingleFolderWorkspaceIdentifier): ISingleFolderWorkspaceIdentifier;
export function reviveIdentifier(identifier: IEmptyWorkspaceIdentifier): IEmptyWorkspaceIdentifier;
export function reviveIdentifier(identifier: ISerializedWorkspaceIdentifier | ISerializedSingleFolderWorkspaceIdentifier | IEmptyWorkspaceIdentifier | undefined): IAnyWorkspaceIdentifier | undefined;
export function reviveIdentifier(identifier: ISerializedWorkspaceIdentifier | ISerializedSingleFolderWorkspaceIdentifier | IEmptyWorkspaceIdentifier | undefined): IAnyWorkspaceIdentifier | undefined {

	const singleFolderIdentifierCandidate = identifier as ISerializedSingleFolderWorkspaceIdentifier | undefined;
	if (singleFolderIdentifierCandidate?.uri) {
		return { id: singleFolderIdentifierCandidate.id, uri: URI.revive(singleFolderIdentifierCandidate.uri) };
	}

	const workspaceIdentifierCandidate = identifier as ISerializedWorkspaceIdentifier | undefined;
	if (workspaceIdentifierCandidate?.configPath) {
		return { id: workspaceIdentifierCandidate.id, configPath: URI.revive(workspaceIdentifierCandidate.configPath) };
	}

	if (identifier?.id) {
		return { id: identifier.id };
	}

	return undefined;
}

export const enum WorkbenchState {
	EMPTY = 1,
	FOLDER,
	WORKSPACE
}

export interface IWorkspaceFoldersWillChangeEvent {

	readonly changes: IWorkspaceFoldersChangeEvent;
	readonly fromCache: boolean;

	join(promise: Promise<void>): void;
}

export interface IWorkspaceFoldersChangeEvent {
	added: IWorkspaceFolder[];
	removed: IWorkspaceFolder[];
	changed: IWorkspaceFolder[];
}

export interface IWorkspace {

	readonly id: string;

	readonly folders: IWorkspaceFolder[];

	readonly transient?: boolean;

	readonly configuration?: URI | null;

	readonly name?: string;

}

export function isWorkspace(thing: unknown): thing is IWorkspace {
	const candidate = thing as IWorkspace | undefined;

	return !!(candidate && typeof candidate === 'object'
		&& typeof candidate.id === 'string'
		&& Array.isArray(candidate.folders));
}

export interface IWorkspaceFolderData {

	readonly uri: URI;

	readonly name: string;

	readonly index: number;
}

export interface IWorkspaceFolder extends IWorkspaceFolderData {

	toResource: (relativePath: string) => URI;
}

export function isWorkspaceFolder(thing: unknown): thing is IWorkspaceFolder {
	const candidate = thing as IWorkspaceFolder;

	return !!(candidate && typeof candidate === 'object'
		&& URI.isUri(candidate.uri)
		&& typeof candidate.name === 'string'
		&& typeof candidate.toResource === 'function');
}

export class Workspace implements IWorkspace {

	private foldersMap: TernarySearchTree<URI, WorkspaceFolder>;

	private _folders!: WorkspaceFolder[];
	get folders(): WorkspaceFolder[] { return this._folders; }
	set folders(folders: WorkspaceFolder[]) {
		this._folders = folders;
		this.updateFoldersMap();
	}

	constructor(
		private _id: string,
		folders: WorkspaceFolder[],
		private _transient: boolean,
		private _configuration: URI | null,
		private ignorePathCasing: (key: URI) => boolean,
		private _workspaceName?: string,
	) {
		this.foldersMap = TernarySearchTree.forUris<WorkspaceFolder>(this.ignorePathCasing, () => true);
		this.folders = folders;
	}

	update(workspace: Workspace) {
		this._id = workspace.id;
		this._configuration = workspace.configuration;
		this._transient = workspace.transient;
		this._workspaceName = workspace.name;
		this.ignorePathCasing = workspace.ignorePathCasing;
		this.folders = workspace.folders;
	}

	get id(): string {
		return this._id;
	}

	get transient(): boolean {
		return this._transient;
	}

	get configuration(): URI | null {
		return this._configuration;
	}

	set configuration(configuration: URI | null) {
		this._configuration = configuration;
	}

	get name(): string | undefined {
		return this._workspaceName;
	}

	getFolder(resource: URI): IWorkspaceFolder | null {
		if (!resource) {
			return null;
		}

		return this.foldersMap.findSubstr(resource) || null;
	}

	private updateFoldersMap(): void {
		this.foldersMap = TernarySearchTree.forUris<WorkspaceFolder>(this.ignorePathCasing, () => true);
		for (const folder of this.folders) {
			this.foldersMap.set(folder.uri, folder);
		}
	}

	toJSON(): IWorkspace {
		return { id: this.id, folders: this.folders, transient: this.transient, configuration: this.configuration, name: this.name };
	}
}

export interface IRawFileWorkspaceFolder {
	readonly path: string;
	name?: string;
}

export interface IRawUriWorkspaceFolder {
	readonly uri: string;
	name?: string;
}

export class WorkspaceFolder implements IWorkspaceFolder {

	readonly uri: URI;
	readonly name: string;
	readonly index: number;

	constructor(
		data: IWorkspaceFolderData,
		readonly raw?: IRawFileWorkspaceFolder | IRawUriWorkspaceFolder
	) {
		this.uri = data.uri;
		this.index = data.index;
		this.name = data.name;
	}

	toResource(relativePath: string): URI {
		return joinPath(this.uri, relativePath);
	}

	toJSON(): IWorkspaceFolderData {
		return { uri: this.uri, name: this.name, index: this.index };
	}
}

export function toWorkspaceFolder(resource: URI): WorkspaceFolder {
	return new WorkspaceFolder({ uri: resource, index: 0, name: basenameOrAuthority(resource) }, { uri: resource.toString() });
}

export const WORKSPACE_EXTENSION = 'code-workspace';
export const WORKSPACE_SUFFIX = `.${WORKSPACE_EXTENSION}`;
export const WORKSPACE_FILTER = [{ name: localize('codeWorkspace', "Code Workspace"), extensions: [WORKSPACE_EXTENSION] }];
export const UNTITLED_WORKSPACE_NAME = 'workspace.json';

export function isUntitledWorkspace(path: URI, environmentService: IEnvironmentService): boolean {
	return extUriBiasedIgnorePathCase.isEqualOrParent(path, environmentService.untitledWorkspacesHome);
}

export function isTemporaryWorkspace(workspace: IWorkspace): boolean;
export function isTemporaryWorkspace(path: URI): boolean;
export function isTemporaryWorkspace(arg1: IWorkspace | URI): boolean {
	let path: URI | null | undefined;
	if (URI.isUri(arg1)) {
		path = arg1;
	} else {
		path = arg1.configuration;
	}

	return path?.scheme === Schemas.tmp;
}

export const STANDALONE_EDITOR_WORKSPACE_ID = '4064f6ec-cb38-4ad0-af64-ee6467e63c82';
export function isStandaloneEditorWorkspace(workspace: IWorkspace): boolean {
	return workspace.id === STANDALONE_EDITOR_WORKSPACE_ID;
}

export function isSavedWorkspace(path: URI, environmentService: IEnvironmentService): boolean {
	return !isUntitledWorkspace(path, environmentService) && !isTemporaryWorkspace(path);
}

export function hasWorkspaceFileExtension(path: string | URI) {
	const ext = (typeof path === 'string') ? extname(path) : resourceExtname(path);

	return ext === WORKSPACE_SUFFIX;
}

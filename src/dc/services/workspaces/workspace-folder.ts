/**
 * Dardcor Code - Workspace Root Folder Model (Task 134)
 */

import { URI } from '../../core/types/uri.js';

export interface IWorkspaceFolder {
	readonly uri: URI;
	readonly name: string;
	readonly index: number;
	toResource(relativePath: string): URI;
	toString(): string;
}

export function getWorkspaceFolderName(uri: URI): string {
	const path = uri.path.replace(/\/+$/, '');
	const idx = path.lastIndexOf('/');
	return decodeURIComponent(idx === -1 ? path : path.substring(idx + 1));
}

export interface IWorkspaceFolderInit {
	readonly uri: URI;
	readonly name?: string;
	readonly index?: number;
}

export class WorkspaceFolder implements IWorkspaceFolder {
	readonly uri: URI;
	readonly name: string;
	readonly index: number;

	constructor(uri: URI, name?: string, index?: number);
	constructor(init: IWorkspaceFolderInit);
	constructor(uriOrInit: URI | IWorkspaceFolderInit, name?: string, index: number = 0) {
		if (uriOrInit instanceof URI) {
			this.uri = uriOrInit;
			this.name = name ?? getWorkspaceFolderName(uriOrInit);
			this.index = index;
		} else {
			this.uri = uriOrInit.uri;
			this.name = uriOrInit.name ?? getWorkspaceFolderName(uriOrInit.uri);
			this.index = uriOrInit.index ?? 0;
		}
	}

	public toResource(relativePath: string): URI {
		const rel = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
		const base = this.uri.path.endsWith('/') ? this.uri.path.slice(0, -1) : this.uri.path;
		const path = rel ? `${base}/${rel}` : base;
		return URI.from({ scheme: this.uri.scheme, authority: this.uri.authority, path });
	}

	public toString(): string {
		return this.uri.toString();
	}
}

export function isWorkspaceFolder(value: unknown): value is IWorkspaceFolder {
	return !!value
		&& typeof (value as any).toResource === 'function'
		&& typeof (value as any).uri === 'object'
		&& typeof (value as any).uri.scheme === 'string';
}

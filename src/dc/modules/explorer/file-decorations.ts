/**
 * Dardcor Code - Git Status File Name Color Decorations
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { GitService, IGitStatusEntry } from '../scm/git-service';
import { Path } from '../../core/types/path';

export type FileDecorationKind = 'added' | 'modified' | 'deleted' | 'untracked' | 'conflicted' | 'renamed';

export interface IFileDecoration {
	readonly kind: FileDecorationKind;
	readonly color: string;
	readonly badge?: string;
}

export const FILE_DECORATION_COLORS: Record<FileDecorationKind, string> = {
	added: '#23d18b',
	modified: '#e5e510',
	deleted: '#f14c4c',
	untracked: '#8a8a8a',
	conflicted: '#f14c4c',
	renamed: '#3794ff'
};

export class FileDecorations extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _git: GitService | undefined;
	private _rootPath = '';
	private _statusByPath = new Map<string, IGitStatusEntry>();

	constructor(git?: GitService) {
		super();
		this._git = git;
	}

	get decorationsCount(): number {
		return this._statusByPath.size;
	}

	public async refresh(rootPath: string): Promise<void> {
		this._rootPath = rootPath;
		this._statusByPath.clear();
		if (this._git) {
			try {
				const entries = await this._git.status(rootPath);
				for (const entry of entries) {
					this._statusByPath.set(this._normalize(entry.path), entry);
				}
			} catch {
				// git tidak tersedia
			}
		}
		this._onDidChange.fire();
	}

	public getDecoration(relativePath: string): IFileDecoration | undefined {
		const entry = this._statusByPath.get(this._normalize(relativePath));
		if (!entry) {
			return undefined;
		}
		return FileDecorations.decorationFromStatus(entry.status, entry.untracked);
	}

	public applyToElement(element: HTMLElement, relativePath: string): void {
		const decoration = this.getDecoration(relativePath);
		if (decoration) {
			element.style.color = decoration.color;
			element.title = `Git: ${this._labelFor(decoration.kind)}`;
		} else {
			element.style.color = '';
			element.title = '';
		}
	}

	public static decorationFromStatus(status: string, untracked: boolean): IFileDecoration {
		if (untracked || status === '?') {
			return { kind: 'untracked', color: FILE_DECORATION_COLORS.untracked };
		}
		switch (status.toUpperCase()) {
			case 'A':
				return { kind: 'added', color: FILE_DECORATION_COLORS.added, badge: 'A' };
			case 'M':
				return { kind: 'modified', color: FILE_DECORATION_COLORS.modified, badge: 'M' };
			case 'D':
				return { kind: 'deleted', color: FILE_DECORATION_COLORS.deleted, badge: 'D' };
			case 'R':
				return { kind: 'renamed', color: FILE_DECORATION_COLORS.renamed, badge: 'R' };
			case 'U':
				return { kind: 'conflicted', color: FILE_DECORATION_COLORS.conflicted, badge: 'U' };
			case 'C':
				return { kind: 'renamed', color: FILE_DECORATION_COLORS.renamed, badge: 'C' };
			default:
				return { kind: 'modified', color: FILE_DECORATION_COLORS.modified };
		}
	}

	public static getColorForStatus(status: string): string {
		return FileDecorations.decorationFromStatus(status, status === '?').color;
	}

	public static getStatusLabel(status: string): string {
		const map: Record<string, string> = {
			A: 'Added',
			M: 'Modified',
			D: 'Deleted',
			R: 'Renamed',
			U: 'Conflicted',
			C: 'Copied',
			'?': 'Untracked'
		};
		return map[status] ?? 'Changed';
	}

	private _labelFor(kind: FileDecorationKind): string {
		const map: Record<FileDecorationKind, string> = {
			added: 'Added',
			modified: 'Modified',
			deleted: 'Deleted',
			untracked: 'Untracked',
			conflicted: 'Conflicted',
			renamed: 'Renamed'
		};
		return map[kind];
	}

	private _normalize(path: string): string {
		return Path.normalize(path).replace(/^\//, '');
	}
}

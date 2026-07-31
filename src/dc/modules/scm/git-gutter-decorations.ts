/**
 * Dardcor Code - Editor Gutter Diff Markers
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { GitService } from './git-service.js';
import { Path } from '../../core/types/path.js';

export const enum GutterDecorationType {
	Added = 1,
	Modified = 2,
	Deleted = 3
}

export interface IGutterDecoration {
	readonly lineNumber: number;
	readonly type: GutterDecorationType;
}

const HUNK_HEADER_REGEX = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export class GitGutterDecorations extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private _decorations = new Map<number, IGutterDecoration>();
	private _filePath: string | undefined;

	constructor(private readonly _git: GitService, private readonly _rootPath: string) {
		super();
	}

	public get filePath(): string | undefined {
		return this._filePath;
	}

	public getDecorations(): ReadonlyMap<number, IGutterDecoration> {
		return this._decorations;
	}

	public async updateForFile(filePath: string): Promise<void> {
		const relative = Path.normalize(filePath);
		const root = Path.normalize(this._rootPath);
		const relPath = relative.startsWith(root) ? relative.substring(root.length).replace(/^\//, '') : filePath;

		let diffText = '';
		try {
			diffText = await this._git.diffHead(this._rootPath, relPath);
		} catch {
			diffText = '';
		}
		this._filePath = filePath;
		this._decorations = GitGutterDecorations.parseDiff(diffText);
		this._onDidChange.fire();
	}

	public static parseDiff(diffText: string): Map<number, IGutterDecoration> {
		const decorations = new Map<number, IGutterDecoration>();
		let newLineNumber = 0;
		const lines = diffText.split(/\r?\n/);

		for (const line of lines) {
			const hunk = HUNK_HEADER_REGEX.exec(line);
			if (hunk) {
				newLineNumber = parseInt(hunk[3], 10);
				continue;
			}
			if (newLineNumber <= 0) {
				continue;
			}
			if (line.startsWith('+') && !line.startsWith('+++')) {
				decorations.set(newLineNumber, { lineNumber: newLineNumber, type: GutterDecorationType.Added });
				newLineNumber++;
			} else if (line.startsWith('-') && !line.startsWith('---')) {
				decorations.set(newLineNumber, { lineNumber: newLineNumber, type: GutterDecorationType.Deleted });
			} else if (line.startsWith(' ')) {
				newLineNumber++;
			} else if (line.startsWith('\\')) {
				// "No newline at end of file" marker - skip
			} else {
				newLineNumber = 0;
			}
		}
		return decorations;
	}

	public clear(): void {
		this._decorations.clear();
		this._filePath = undefined;
		this._onDidChange.fire();
	}

	public renderInto(gutterContainer: HTMLElement, lineHeight: number, visibleStartLine: number, visibleEndLine: number): void {
		gutterContainer.textContent = '';
		for (const decoration of this._decorations.values()) {
			if (decoration.lineNumber < visibleStartLine || decoration.lineNumber > visibleEndLine) {
				continue;
			}
			const marker = document.createElement('div');
			marker.className = 'dc-gutter-decoration';
			marker.style.position = 'absolute';
			marker.style.width = '100%';
			marker.style.height = `${lineHeight}px`;
			marker.style.top = `${(decoration.lineNumber - visibleStartLine) * lineHeight}px`;
			marker.style.left = '0';
			marker.style.pointerEvents = 'none';
			marker.title = decoration.type === GutterDecorationType.Added
				? 'Baris ditambahkan'
				: decoration.type === GutterDecorationType.Deleted
					? 'Baris dihapus'
					: 'Baris dimodifikasi';
			if (decoration.type === GutterDecorationType.Added) {
				marker.style.background = 'rgba(35,209,139,0.25)';
				marker.style.borderLeft = '3px solid #23d18b';
			} else if (decoration.type === GutterDecorationType.Deleted) {
				marker.style.background = 'rgba(244,76,76,0.25)';
				marker.style.borderLeft = '3px solid #f14c4c';
				marker.style.height = `${Math.max(2, lineHeight / 2)}px`;
			} else {
				marker.style.background = 'rgba(229,229,16,0.15)';
				marker.style.borderLeft = '3px solid #e5e510';
			}
			gutterContainer.appendChild(marker);
		}
	}
}

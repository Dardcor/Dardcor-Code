/**
 * Dardcor Code - Virtualized File Tree Node DOM Renderer
 */

import { ITreeNode, ITreeRenderer } from '../../core/dom/tree-view.js';
import { CssInjector } from '../../core/dom/css-injector.js';
import { IFileTreeElement } from './file-tree-model.js';
import { Path } from '../../core/types/path.js';
import { escape } from '../../core/types/strings.js';
import { toDisposable } from '../../core/lifecycle/disposable.js';

const FILE_TREE_STYLE_ID = 'dc-file-tree-styles';

const FILE_ICONS: Record<string, string> = {
	'.js': '\u{1F4C4}', '.ts': '\u{1F4C4}', '.tsx': '\u{1F4C4}', '.jsx': '\u{1F4C4}',
	'.json': '\u{2699}', '.html': '\u{1F5C4}', '.css': '\u{1F5A8}', '.scss': '\u{1F5A8}',
	'.md': '\u{1F4DD}', '.svg': '\u{1F5BC}', '.png': '\u{1F5BC}', '.jpg': '\u{1F5BC}',
	'.jpeg': '\u{1F5BC}', '.gif': '\u{1F5BC}', '.ico': '\u{1F5BC}',
	'.py': '\u{1F40D}', '.java': '\u{2615}', '.c': '\u{2699}', '.cpp': '\u{2699}',
	'.h': '\u{2699}', '.rs': '\u{1F99A}', '.go': '\u{1F40A}', '.rb': '\u{1F380}',
	'.php': '\u{1F418}', '.sql': '\u{1F4BE}', '.yml': '\u{2699}', '.yaml': '\u{2699}',
	'.xml': '\u{2699}', '.sh': '\u{1F4BB}', '.bat': '\u{1F4BB}', '.ps1': '\u{1F4BB}',
	'.exe': '\u{1F4E6}', '.zip': '\u{1F4E6}', '.tar': '\u{1F4E6}', '.gz': '\u{1F4E6}',
	'.pdf': '\u{1F4C4}', '.txt': '\u{1F4C4}', '.gitignore': '\u{1F5C2}', '.env': '\u{2699}',
	'.lock': '\u{1F512}', '.dll': '\u{2699}', '.map': '\u{1F5C2}', '.min.js': '\u{1F4A9}'
};

const FOLDER_ICON = '\u{1F4C1}';
const FOLDER_OPEN_ICON = '\u{1F4C2}';
const FILE_ICON = '\u{1F4C4}';
const CHEVRON_COLLAPSED = '\u25B8';
const CHEVRON_EXPANDED = '\u25BE';

let stylesInjected = false;

function injectStyles(): void {
	if (stylesInjected) {
		return;
	}
	stylesInjected = true;
	CssInjector.inject(FILE_TREE_STYLE_ID, `
		.dc-file-row {
			user-select: none;
			color: #cccccc;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.dc-file-row:hover { background-color: #2a2d2e; }
		.dc-file-row.dc-file-row-selected { background-color: #37373d; }
		.dc-file-row.dc-file-row-focused { background-color: #094771; color: #ffffff; }
		.dc-file-chevron { display: inline-block; width: 14px; color: #cccccc; font-size: 9px; }
		.dc-file-chevron.dc-file-chevron-hidden { visibility: hidden; }
		.dc-file-icon { margin: 0 4px 0 2px; font-size: 13px; }
		.dc-file-name { font-size: 13px; }
		.dc-file-name.dc-file-dir-name { font-weight: 600; }
	`);
}

function getFileIcon(name: string, isDirectory: boolean): string {
	if (isDirectory) {
		return FOLDER_ICON;
	}
	const ext = Path.extname(name).toLowerCase();
	if (ext) {
		return FILE_ICONS[ext] ?? FILE_ICON;
	}
	if (name.startsWith('.')) {
		return '\u{2699}';
	}
	return FILE_ICON;
}

export function getFileNameColor(name: string): string {
	return '#cccccc';
}

export class FileTreeRenderer implements ITreeRenderer<IFileTreeElement> {
	public renderElement(node: ITreeNode<IFileTreeElement>, _index: number, container: HTMLElement): void {
		injectStyles();
		const element = node.element;
		const row = container;
		row.classList.add('dc-file-row');
		row.dataset['dcResource'] = element.resource.toString();
		row.dataset['dcName'] = element.name;
		row.dataset['dcDir'] = element.isDirectory ? '1' : '0';

		const chevron = document.createElement('span');
		chevron.className = 'dc-file-chevron';
		if (element.isDirectory) {
			chevron.textContent = node.collapsed ? CHEVRON_COLLAPSED : CHEVRON_EXPANDED;
		} else {
			chevron.classList.add('dc-file-chevron-hidden');
			chevron.textContent = '\u00A0';
		}
		row.appendChild(chevron);

		const icon = document.createElement('span');
		icon.className = 'dc-file-icon';
		icon.textContent = getFileIcon(element.name, element.isDirectory);
		row.appendChild(icon);

		const label = document.createElement('span');
		label.className = 'dc-file-name' + (element.isDirectory ? ' dc-file-dir-name' : '');
		label.textContent = element.name;
		label.title = element.resource.path;
		row.appendChild(label);
	}

	public disposeElement(_node: ITreeNode<IFileTreeElement>, _index: number, container: HTMLElement): void {
		container.classList.remove('dc-file-row', 'dc-file-row-selected', 'dc-file-row-focused');
		container.textContent = '';
	}
}

export function disposeFileTreeStyles(): void {
	if (stylesInjected) {
		CssInjector.inject(FILE_TREE_STYLE_ID, '');
		stylesInjected = false;
	}
}

export function escapeFileName(name: string): string {
	return escape(name);
}

export const FileTreeStylesDisposable = toDisposable(disposeFileTreeStyles);

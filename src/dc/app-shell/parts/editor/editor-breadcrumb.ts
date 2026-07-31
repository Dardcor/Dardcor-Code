/**
 * Dardcor Code - File Path Breadcrumb Bar Top Component Inside Editor Pane
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $, clearNode } from '../../../core/dom/element';
import { URI } from '../../../core/types/uri';
import { Path } from '../../../core/types/path';

export interface IBreadcrumbSegment {
	readonly label: string;
	readonly path: string;
	readonly isFile: boolean;
	readonly isRoot: boolean;
}

export interface IBreadcrumbNavigationEvent {
	readonly path: string;
	readonly isFile: boolean;
}

export class EditorBreadcrumb extends Disposable {
	private readonly _container: HTMLElement;
	private _uri: URI | null = null;
	private _separator = '\u203a';
	private _maxSegments = 6;

	private readonly _onDidNavigate = this._register(new Emitter<IBreadcrumbNavigationEvent>());
	readonly onDidNavigate: Event<IBreadcrumbNavigationEvent> = this._onDidNavigate.event;

	constructor(
		parent: HTMLElement,
		private readonly _options: { visible?: boolean } = {}
	) {
		super();
		this._container = $<HTMLElement>('div', 'dc-editor-breadcrumb');
		this._container.style.cssText = 'height:24px;background:#2d2d2d;display:flex;align-items:center;gap:2px;padding:0 10px;font-size:11px;color:#cccccc;font-family:Segoe UI, sans-serif;user-select:none;overflow:hidden;flex-shrink:0;white-space:nowrap;';
		this._container.style.display = this._options.visible === false ? 'none' : 'flex';
		parent.appendChild(this._container);
	}

	get element(): HTMLElement {
		return this._container;
	}

	get uri(): URI | null {
		return this._uri;
	}

	setVisible(visible: boolean): void {
		this._container.style.display = visible ? 'flex' : 'none';
	}

	setUri(uri: URI): void {
		this._uri = uri;
		this._render();
	}

	clear(): void {
		this._uri = null;
		clearNode(this._container);
	}

	setSeparator(separator: string): void {
		this._separator = separator;
		if (this._uri) {
			this._render();
		}
	}

	getSegments(): IBreadcrumbSegment[] {
		if (!this._uri) {
			return [];
		}
		return this._computeSegments(this._uri);
	}

	private _computeSegments(uri: URI): IBreadcrumbSegment[] {
		const isUntitled = uri.scheme === 'untitled';
		const segments: IBreadcrumbSegment[] = [];
		if (isUntitled) {
			segments.push({ label: uri.path, path: uri.toString(), isFile: true, isRoot: true });
			return segments;
		}
		const rawPath = uri.path.replace(/\\/g, '/');
		const parts = rawPath.split('/').filter(p => p.length > 0 && p !== '.');
		const fileName = parts.length > 0 ? parts[parts.length - 1] : uri.path;

		let root: IBreadcrumbSegment;
		if (uri.scheme === 'file' && uri.authority) {
			root = { label: uri.authority, path: `//${uri.authority}`, isFile: false, isRoot: true };
		} else if (uri.scheme === 'file') {
			root = { label: '/', path: '/', isFile: false, isRoot: true };
		} else {
			root = { label: uri.scheme, path: `${uri.scheme}:`, isFile: false, isRoot: true };
		}
		segments.push(root);

		const dirParts = parts.slice(0, -1);
		if (dirParts.length > this._maxSegments) {
			const hidden = dirParts.length - this._maxSegments + 2;
			segments.push({ label: `... (${hidden} hidden)`, path: '/', isFile: false, isRoot: false });
			const visibleParts = dirParts.slice(hidden - 1);
			let acc = root.path.endsWith('/') ? root.path.slice(0, -1) : root.path;
			for (const part of visibleParts) {
				acc += '/' + part;
				segments.push({ label: part, path: acc, isFile: false, isRoot: false });
			}
		} else {
			let acc = root.path.endsWith('/') ? root.path.slice(0, -1) : root.path;
			for (const part of dirParts) {
				acc += '/' + part;
				segments.push({ label: part, path: acc, isFile: false, isRoot: false });
			}
		}

		segments.push({ label: fileName, path: rawPath, isFile: true, isRoot: false });
		return segments;
	}

	private _render(): void {
		clearNode(this._container);
		const segments = this.getSegments();
		if (segments.length === 0) {
			this._container.style.display = 'none';
			return;
		}
		this._container.style.display = this._options.visible === false ? 'none' : 'flex';
		for (let i = 0; i < segments.length; i++) {
			const segment = segments[i];
			const label = $<HTMLElement>('span', 'dc-breadcrumb-segment');
			label.textContent = segment.label;
			label.title = segment.path;
			label.style.cssText = 'padding:2px 4px;border-radius:3px;cursor:default;max-width:200px;overflow:hidden;text-overflow:ellipsis;' +
				(segment.isFile ? 'color:#ffffff;font-weight:600;' : 'color:#cccccc;');
			label.addEventListener('mousemove', () => {
				label.style.background = '#3c3c3c';
			});
			label.addEventListener('mouseleave', () => {
				label.style.background = 'transparent';
			});
			label.addEventListener('click', () => {
				this._onDidNavigate.fire({ path: segment.path, isFile: segment.isFile });
			});
			this._container.appendChild(label);
			if (i < segments.length - 1) {
				const sep = $<HTMLElement>('span', 'dc-breadcrumb-separator');
				sep.textContent = this._separator;
				sep.style.cssText = 'color:#6a6a6a;padding:0 2px;';
				this._container.appendChild(sep);
			}
		}
	}

	dispose(): void {
		this._container.remove();
		super.dispose();
	}
}

export function splitUriPath(uri: URI): string[] {
	const raw = uri.path.replace(/\\/g, '/');
	return raw.split('/').filter(p => p.length > 0);
}

export { Path };

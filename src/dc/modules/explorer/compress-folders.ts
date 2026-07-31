/**
 * Dardcor Code - Single Child Folder Chain Visual Compression
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, addDisposableListener } from '../../core/dom/element';
import { FileTreeNode } from './file-tree-model';
import { FileIcons } from './file-icons';


export class CompressFolders extends Disposable {
	private readonly _onDidToggle = this._register(new Emitter<FileTreeNode>());
	readonly onDidToggle: Event<FileTreeNode> = this._onDidToggle.event;

	private _enabled = true;

	constructor(private readonly _expandedChains = new Set<string>()) {
		super();
	}

	get enabled(): boolean {
		return this._enabled;
	}

	public setEnabled(enabled: boolean): void {
		this._enabled = enabled;
	}

	public isChainExpanded(node: FileTreeNode): boolean {
		return this._expandedChains.has(CompressFolders.getChainKey(node));
	}

	public toggleChain(node: FileTreeNode): void {
		const key = CompressFolders.getChainKey(node);
		if (this._expandedChains.has(key)) {
			this._expandedChains.delete(key);
		} else {
			this._expandedChains.add(key);
		}
		this._onDidToggle.fire(node);
	}

	public static isCompressible(node: FileTreeNode): boolean {
		return node.isDirectory && !node.collapsed && node.children.length === 1
			&& node.children[0].isDirectory && node.children[0].collapsed;
	}

	public static getChain(node: FileTreeNode): FileTreeNode[] {
		const chain: FileTreeNode[] = [node];
		let current = node;
		while (current.children.length === 1 && current.children[0].isDirectory && current.children[0].collapsed) {
			current = current.children[0];
			chain.push(current);
		}
		return chain;
	}

	public static getChainKey(node: FileTreeNode): string {
		return CompressFolders.getChain(node).map(n => n.element.resource.path).join('>');
	}

	public static getCompressedLabel(node: FileTreeNode, separator = ' > '): string {
		const chain = CompressFolders.getChain(node);
		if (chain.length <= 1) {
			return node.element.name;
		}
		return chain.map(n => n.element.name).join(separator);
	}

	public renderCompressedRow(parentDom: HTMLElement, node: FileTreeNode, options: {
		onExpand: () => void;
		onOpen: (node: FileTreeNode) => void;
	}): HTMLElement {
		const row = $<HTMLElement>('div', 'dc-compressed-folder-row');
		row.style.cssText = 'display:flex;align-items:center;gap:2px;padding:3px 8px 3px 0;cursor:pointer;user-select:none;';
		row.addEventListener('mouseenter', () => {
			row.style.background = '#2a2d2e';
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = 'transparent';
		});

		const chain = CompressFolders.getChain(node);
		const isExpanded = this.isChainExpanded(node);

		const chevron = $<HTMLElement>('span');
		chevron.textContent = '\u25BE';
		chevron.style.cssText = 'font-size:9px;width:12px;color:#cccccc;';

		const icon = $<HTMLElement>('span');
		icon.innerHTML = FileIcons.getIconHtml(chain[0].element.name, true, !isExpanded);

		const label = $<HTMLElement>('span');
		label.textContent = CompressFolders.getCompressedLabel(node);
		label.style.cssText = 'font-size:13px;color:#cccccc;font-weight:600;';
		label.title = chain.map(n => n.element.resource.path).join(' \u21E8 ');

		row.appendChild(chevron);
		row.appendChild(icon);
		row.appendChild(label);
		parentDom.appendChild(row);

		this._register(addDisposableListener(row, 'click', (e: MouseEvent) => {
			e.stopPropagation();
			if (isExpanded) {
				this.toggleChain(node);
				options.onExpand();
			} else {
				this.toggleChain(node);
				options.onExpand();
			}
		}));
		this._register(addDisposableListener(label, 'dblclick', (e: MouseEvent) => {
			e.stopPropagation();
			options.onOpen(chain[chain.length - 1]);
		}));
		return row;
	}
}

export function getChainLeaf(node: FileTreeNode): FileTreeNode {
	const chain = CompressFolders.getChain(node);
	return chain[chain.length - 1];
}

export function isCompressedPathVisible(node: FileTreeNode, compressedRoots: Iterable<string>): boolean {
	const path = node.element.resource.path;
	for (const root of compressedRoots) {
		if (path.startsWith(root) && path !== root) {
			return false;
		}
	}
	return true;
}

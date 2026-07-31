/**
 * Dardcor Code - Grouped File Change List for Source Control
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { URI } from '../../core/types/uri';
import { Path } from '../../core/types/path';

export type ScmResourceGroupKind = 'workingTree' | 'index' | 'untracked' | 'merge' | 'other';

export interface IScmResource {
	readonly resourceUri: URI;
	readonly name: string;
	readonly isModified: boolean;
	readonly isStaged: boolean;
	readonly isUntracked: boolean;
}

export class ScmResourceGroup extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private _resources: IScmResource[] = [];

	constructor(
		private readonly _id: string,
		private _label: string,
		private readonly _kind: ScmResourceGroupKind,
		initial: IScmResource[] = []
	) {
		super();
		this._resources = initial;
	}

	get id(): string {
		return this._id;
	}

	get label(): string {
		return this._label;
	}

	set label(value: string) {
		this._label = value;
	}

	get kind(): ScmResourceGroupKind {
		return this._kind;
	}

	get resources(): IScmResource[] {
		return [...this._resources];
	}

	get count(): number {
		return this._resources.length;
	}

	public setResources(resources: IScmResource[]): void {
		this._resources = [...resources];
		this._onDidChange.fire();
	}

	public add(resource: IScmResource): void {
		if (!this._resources.some(r => r.resourceUri.toString() === resource.resourceUri.toString())) {
			this._resources.push(resource);
			this._onDidChange.fire();
		}
	}

	public remove(resourceUri: URI): void {
		const before = this._resources.length;
		this._resources = this._resources.filter(r => r.resourceUri.toString() !== resourceUri.toString());
		if (this._resources.length !== before) {
			this._onDidChange.fire();
		}
	}

	public clear(): void {
		if (this._resources.length > 0) {
			this._resources = [];
			this._onDidChange.fire();
		}
	}

	public getResource(resourceUri: URI): IScmResource | undefined {
		const target = resourceUri.toString();
		return this._resources.find(r => r.resourceUri.toString() === target);
	}

	public render(parentDom: HTMLElement, options: {
		collapsible?: boolean;
		onSelect?: (resource: IScmResource) => void;
		onToggleGroup?: () => void;
	} = {}): HTMLElement {
		const collapsible = options.collapsible ?? true;
		let collapsed = false;

		const container = $<HTMLElement>('div', 'dc-scm-group');

		const header = $<HTMLElement>('div');
		header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 10px;cursor:pointer;user-select:none;';
		header.addEventListener('mouseenter', () => {
			header.style.background = '#2a2d2e';
		});
		header.addEventListener('mouseleave', () => {
			header.style.background = 'transparent';
		});

		const chevron = $<HTMLElement>('span');
		chevron.textContent = collapsible ? '\u25BE' : '';
		chevron.style.cssText = 'font-size:9px;width:10px;color:#cccccc;';

		const label = $<HTMLElement>('span');
		label.style.cssText = 'font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#bbbbbb;flex:1;';

		const count = $<HTMLElement>('span');
		count.style.cssText = 'font-size:11px;color:#8a8a8a;background:#2a2d2e;border-radius:8px;padding:0 6px;';

		const refreshLabel = (): void => {
			label.textContent = this._label;
			count.textContent = String(this.count);
		};
		refreshLabel();
		this._register(this.onDidChange(refreshLabel));

		header.appendChild(chevron);
		header.appendChild(label);
		header.appendChild(count);
		container.appendChild(header);

		const list = $<HTMLElement>('div', 'dc-scm-group-list');
		container.appendChild(list);

		const renderList = (): void => {
			clearNode(list);
			for (const resource of this._resources) {
				list.appendChild(this._renderResource(resource, options.onSelect));
			}
		};
		renderList();
		this._register(this.onDidChange(renderList));

		if (collapsible) {
			this._register(addDisposableListener(header, 'click', () => {
				collapsed = !collapsed;
				chevron.textContent = collapsed ? '\u25B8' : '\u25BE';
				list.style.display = collapsed ? 'none' : '';
				options.onToggleGroup?.();
			}));
		}

		parentDom.appendChild(container);
		return container;
	}

	private _renderResource(resource: IScmResource, onSelect?: (resource: IScmResource) => void): HTMLElement {
		const row = $<HTMLElement>('div');
		row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 10px 2px 20px;cursor:pointer;user-select:none;';
		row.addEventListener('mouseenter', () => {
			row.style.background = '#2a2d2e';
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = 'transparent';
		});

		const status = $<HTMLElement>('span');
		status.textContent = resource.isStaged ? 'A' : resource.isUntracked ? 'U' : 'M';
		status.style.cssText = `font-size:10px;font-weight:600;width:14px;text-align:center;color:${resource.isStaged ? '#4ec9b0' : '#dcdcaa'};`;

		const name = $<HTMLElement>('span');
		name.textContent = resource.name;
		name.style.cssText = 'font-size:13px;color:#cccccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
		name.title = resource.resourceUri.path;

		row.appendChild(status);
		row.appendChild(name);
		if (onSelect) {
			this._register(addDisposableListener(row, 'click', () => onSelect(resource)));
		}
		return row;
	}
}

export function resourceNameFromUri(resourceUri: URI): string {
	return Path.basename(resourceUri.path);
}

/**
 * Dardcor Code - Left Collapsible Tool View Container
 */

import { Disposable, IDisposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $, clearNode } from '../../../core/dom/element';
import { IViewletDescriptor } from './viewlet-registry';
import { SidebarViewContainer } from './sidebar-view-container';

export class SidebarPart extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _header: HTMLElement;
	private readonly _headerTitle: HTMLElement;
	private readonly _body: HTMLElement;
	private readonly _viewContainer: SidebarViewContainer;
	private _activeViewlet: IViewletDescriptor | null = null;
	private _isVisible = true;
	private _disposedView: IDisposable | null = null;

	private readonly _onDidChangeViewlet = this._register(new Emitter<IViewletDescriptor | null>());
	private readonly _onDidChangeVisibility = this._register(new Emitter<boolean>());
	readonly onDidChangeViewlet: Event<IViewletDescriptor | null> = this._onDidChangeViewlet.event;
	readonly onDidChangeVisibility: Event<boolean> = this._onDidChangeVisibility.event;

	constructor(container: HTMLElement) {
		super();
		this._container = container;
		container.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;';

		this._header = $<HTMLElement>('div', 'dc-sidebar-header');
		this._header.style.cssText = 'height:35px;background:#252526;display:flex;align-items:center;padding:0 10px;user-select:none;flex-shrink:0;';
		this._headerTitle = $<HTMLElement>('span', 'dc-sidebar-header-title');
		this._headerTitle.style.cssText = 'flex:1;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#bbbbbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		const headerActions = $<HTMLElement>('div', 'dc-sidebar-header-actions');
		headerActions.style.cssText = 'display:flex;gap:4px;';
		const collapseBtn = $<HTMLElement>('span', 'dc-sidebar-header-collapse');
		collapseBtn.textContent = '\u203a';
		collapseBtn.title = 'Collapse Sidebar';
		collapseBtn.style.cssText = 'cursor:pointer;color:#858585;font-size:18px;padding:0 4px;';
		collapseBtn.addEventListener('click', () => this.setVisible(false));
		headerActions.appendChild(collapseBtn);
		this._header.appendChild(this._headerTitle);
		this._header.appendChild(headerActions);
		this._container.appendChild(this._header);

		this._body = $<HTMLElement>('div', 'dc-sidebar-body');
		this._body.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;background:#252526;';
		this._container.appendChild(this._body);

		this._viewContainer = new SidebarViewContainer(this._body);
		this._register(this._viewContainer);
	}

	get isVisible(): boolean {
		return this._isVisible;
	}

	get activeViewlet(): IViewletDescriptor | null {
		return this._activeViewlet;
	}

	get headerElement(): HTMLElement {
		return this._header;
	}

	get bodyElement(): HTMLElement {
		return this._body;
	}

	get contentContainer(): SidebarViewContainer {
		return this._viewContainer;
	}

	setVisible(visible: boolean): void {
		if (this._isVisible === visible) {
			return;
		}
		this._isVisible = visible;
		this._container.style.display = visible ? 'flex' : 'none';
		this._onDidChangeVisibility.fire(visible);
	}

	setViewlet(descriptor: IViewletDescriptor | null): void {
		if (this._activeViewlet === descriptor) {
			return;
		}
		this._disposedView?.dispose();
		this._disposedView = null;
		this._activeViewlet = descriptor;
		this._viewContainer.clear();

		if (descriptor) {
			this._headerTitle.textContent = descriptor.title;
			this._disposedView = descriptor.createView(this._viewContainer.element) as any;
			this.setVisible(true);
		}
 else {
			this._headerTitle.textContent = '';
			this._viewContainer.clear();
		}
		this._onDidChangeViewlet.fire(descriptor);
	}

	clearViewlet(): void {
		this.setViewlet(null);
	}

	addSection(section: { id: string; title: string; icon?: string; content: HTMLElement; expanded?: boolean }): void {
		this._viewContainer.addSection(section);
	}

	dispose(): void {
		this._disposedView?.dispose();
		clearNode(this._container);
		super.dispose();
	}
}

/**
 * Dardcor Code - Bottom Dockable Tool Container
 */

import { Disposable, IDisposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $, clearNode } from '../../../core/dom/element';
import { PanelRegistry, IPanelDescriptor } from './panel-registry';
import { PanelTabBar } from './panel-tab-bar';

export class PanelPart extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _tabBar: PanelTabBar;
	private readonly _content: HTMLElement;
	private _activePanel: IPanelDescriptor | null = null;
	private _activeView: IDisposable | null = null;
	private _maximized = false;
	private _visible = true;

	private readonly _onDidChangePanel = this._register(new Emitter<IPanelDescriptor | null>());
	private readonly _onDidChangeMaximized = this._register(new Emitter<boolean>());
	private readonly _onDidChangeVisibility = this._register(new Emitter<boolean>());

	readonly onDidChangePanel: Event<IPanelDescriptor | null> = this._onDidChangePanel.event;
	readonly onDidChangeMaximized: Event<boolean> = this._onDidChangeMaximized.event;
	readonly onDidChangeVisibility: Event<boolean> = this._onDidChangeVisibility.event;

	constructor(
		container: HTMLElement,
		private readonly _registry: PanelRegistry = PanelRegistry.instance
	) {
		super();
		this._container = container;
		container.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;background:#1e1e1e;';

		this._tabBar = new PanelTabBar(container);
		this._register(this._tabBar);
		this._content = $<HTMLElement>('div', 'dc-panel-content');
		this._content.style.cssText = 'flex:1;overflow:hidden;position:relative;background:#1e1e1e;';
		container.appendChild(this._content);

		this._register(this._registry.onDidChange(() => this._render()));
		this._tabBar.onDidSelectPanel(descriptor => this.showPanel(descriptor.id));
		this._tabBar.onDidMaximize(() => this.toggleMaximized());
		this._tabBar.onDidClosePanel(() => this.setVisible(false));

		this._render();
	}

	get activePanel(): IPanelDescriptor | null {
		return this._activePanel;
	}

	get isVisible(): boolean {
		return this._visible;
	}

	get isMaximized(): boolean {
		return this._maximized;
	}

	get tabBar(): PanelTabBar {
		return this._tabBar;
	}

	get contentElement(): HTMLElement {
		return this._content;
	}

	showPanel(id: string): void {
		const descriptor = this._registry.getPanel(id);
		if (!descriptor) {
			return;
		}
		this._activeView?.dispose();
		this._activeView = null;
		this._activePanel = descriptor;
		clearNode(this._content);
		this._activeView = descriptor.createView(this._content);
		this._tabBar.setActive(id);
		this.setVisible(true);
		this._onDidChangePanel.fire(descriptor);
	}

	hidePanel(): void {
		this._activeView?.dispose();
		this._activeView = null;
		this._activePanel = null;
		this._tabBar.setActive(null);
		this.setVisible(false);
		this._onDidChangePanel.fire(null);
	}

	setVisible(visible: boolean): void {
		if (this._visible === visible) {
			return;
		}
		this._visible = visible;
		this._container.style.display = visible ? 'flex' : 'none';
		this._onDidChangeVisibility.fire(visible);
	}

	setMaximized(maximized: boolean): void {
		if (this._maximized === maximized) {
			return;
		}
		this._maximized = maximized;
		this._container.style.height = maximized ? 'calc(100vh - 32px)' : '';
		this._onDidChangeMaximized.fire(maximized);
	}

	toggleMaximized(): void {
		this.setMaximized(!this._maximized);
	}

	private _render(): void {
		const panels = this._registry.getPanels();
		this._tabBar.render(panels, this._activePanel?.id ?? null);
		if (!this._activePanel && panels.length > 0) {
			this.showPanel(panels[0].id);
		}
	}

	dispose(): void {
		this._activeView?.dispose();
		clearNode(this._container);
		super.dispose();
	}
}

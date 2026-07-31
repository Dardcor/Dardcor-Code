/**
 * Dardcor Code - Horizontal / Vertical Split Terminal Pane Inside Single Tab
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { CssInjector } from '../../core/dom/css-injector';
import { TerminalView } from './terminal-view';
import { IConfigurationService } from '../../services/configuration/configuration-service';

const SPLIT_STYLE_ID = 'dc-terminal-split-styles';

export const enum SplitOrientation {
	Vertical = 0,
	Horizontal = 1
}

export interface ITerminalSplitPane {
	readonly id: number;
	readonly view: TerminalView;
	readonly element: HTMLElement;
}

export class TerminalSplit extends Disposable {
	private readonly _onDidSplit = this._register(new Emitter<SplitOrientation>());
	readonly onDidSplit: Event<SplitOrientation> = this._onDidSplit.event;

	private readonly _onDidClosePane = this._register(new Emitter<number>());
	readonly onDidClosePane: Event<number> = this._onDidClosePane.event;

	private readonly _container: HTMLElement;
	private readonly _panes: ITerminalSplitPane[] = [];
	private readonly _configurationService: IConfigurationService | undefined;
	private _orientation: SplitOrientation = SplitOrientation.Horizontal;
	private _idCounter = 1;

	constructor(parentDom: HTMLElement, configurationService?: IConfigurationService) {
		super();
		this._configurationService = configurationService;

		CssInjector.inject(SPLIT_STYLE_ID, `
			.dc-terminal-pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; position: relative; border: 1px solid transparent; }
			.dc-terminal-pane:hover .dc-terminal-pane-close { visibility: visible; }
			.dc-terminal-pane-close { position: absolute; top: 2px; right: 4px; z-index: 5; visibility: hidden; background: #252526; border: none; color: #cccccc; cursor: pointer; font-size: 10px; padding: 2px 4px; border-radius: 2px; }
		`);

		this._container = $<HTMLElement>('div', 'dc-terminal-split');
		this._container.style.cssText = 'display:flex;flex:1;overflow:hidden;';
		parentDom.appendChild(this._container);

		this._addPane();
	}

	get orientation(): SplitOrientation {
		return this._orientation;
	}

	get panes(): ITerminalSplitPane[] {
		return [...this._panes];
	}

	get paneCount(): number {
		return this._panes.length;
	}

	public split(orientation: SplitOrientation = SplitOrientation.Vertical): ITerminalSplitPane {
		this._orientation = orientation;
		const pane = this._addPane();
		this._applyLayout();
		this._onDidSplit.fire(orientation);
		return pane;
	}

	public closePane(id: number): void {
		if (this._panes.length <= 1) {
			return;
		}
		const index = this._panes.findIndex(pane => pane.id === id);
		if (index === -1) {
			return;
		}
		const pane = this._panes[index];
		pane.view.dispose();
		pane.element.remove();
		this._panes.splice(index, 1);
		this._applyLayout();
		this._onDidClosePane.fire(id);
	}

	public setOrientation(orientation: SplitOrientation): void {
		this._orientation = orientation;
		this._applyLayout();
	}

	public focusPane(id: number): void {
		const pane = this._panes.find(p => p.id === id);
		pane?.view.createInstance();
	}

	public clear(): void {
		for (const pane of this._panes) {
			pane.view.dispose();
			pane.element.remove();
		}
		this._panes.splice(0, this._panes.length);
		clearNode(this._container);
	}

	private _addPane(): ITerminalSplitPane {
		const id = this._idCounter++;
		const element = $<HTMLElement>('div', 'dc-terminal-pane');
		element.style.cssText = 'display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;position:relative;';

		const closeBtn = $<HTMLButtonElement>('button', 'dc-terminal-pane-close');
		closeBtn.textContent = '\u2716';
		closeBtn.title = 'Tutup pane';
		this._register(addDisposableListener(closeBtn, 'click', () => this.closePane(id)));
		element.appendChild(closeBtn);

		const viewContainer = $<HTMLElement>('div');
		viewContainer.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';
		element.appendChild(viewContainer);

		const view = new TerminalView(viewContainer, this._configurationService);
		view.createInstance();

		this._panes.push({ id, view, element });
		this._container.appendChild(element);
		this._applyLayout();
		return this._panes[this._panes.length - 1];
	}

	private _applyLayout(): void {
		for (const pane of this._panes) {
			pane.element.style.flex = '1 1 0%';
			pane.element.style.borderLeft = '1px solid #2a2d2e';
			pane.element.style.borderTop = '1px solid #2a2d2e';
		}
		if (this._panes.length > 1) {
			this._container.style.flexDirection = this._orientation === SplitOrientation.Horizontal ? 'row' : 'column';
		} else {
			this._container.style.flexDirection = 'column';
		}
	}
}

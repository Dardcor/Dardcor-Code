/**
 * Dardcor Code - Workspace File Explorer Viewlet
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { $ } from '../../core/dom/element.js';

export class ExplorerViewlet extends Disposable {
	private readonly _container: HTMLElement;

	constructor(parentDom: HTMLElement) {
		super();
		this._container = $<HTMLElement>('div', 'dc-explorer-viewlet');
		this._container.innerHTML = `
			<div class="dc-explorer-title" style="padding:10px;font-weight:bold;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#bbbbbb;">Explorer</div>
			<div class="dc-explorer-tree" style="padding:0 10px;font-size:13px;">
				<div class="dc-tree-item" style="padding:4px 0;cursor:pointer;">📁 src</div>
				<div class="dc-tree-item" style="padding:4px 0 4px 15px;cursor:pointer;">📄 main.ts</div>
				<div class="dc-tree-item" style="padding:4px 0;cursor:pointer;">📄 package.json</div>
				<div class="dc-tree-item" style="padding:4px 0;cursor:pointer;">📄 README.md</div>
			</div>
		`;
		parentDom.appendChild(this._container);
	}
}

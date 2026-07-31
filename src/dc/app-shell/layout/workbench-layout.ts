/**
 * Dardcor Code - Master Workbench Shell Container & Component Layout
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { $ } from '../../core/dom/element.js';

export class WorkbenchLayout extends Disposable {
	public readonly container: HTMLElement;
	public readonly titleBarDom: HTMLElement;
	public readonly mainBodyDom: HTMLElement;
	public readonly activityBarDom: HTMLElement;
	public readonly sideBarDom: HTMLElement;
	public readonly editorPartDom: HTMLElement;
	public readonly panelPartDom: HTMLElement;
	public readonly statusBarDom: HTMLElement;

	constructor(parentDom: HTMLElement) {
		super();
		this.container = $<HTMLElement>('div', 'dc-workbench');
		this.titleBarDom = $<HTMLElement>('div', 'dc-part-titlebar');
		this.mainBodyDom = $<HTMLElement>('div', 'dc-part-mainbody');
		this.activityBarDom = $<HTMLElement>('div', 'dc-part-activitybar');
		this.sideBarDom = $<HTMLElement>('div', 'dc-part-sidebar');
		this.editorPartDom = $<HTMLElement>('div', 'dc-part-editor');
		this.panelPartDom = $<HTMLElement>('div', 'dc-part-panel');
		this.statusBarDom = $<HTMLElement>('div', 'dc-part-statusbar');

		// Build DOM Tree
		this.container.appendChild(this.titleBarDom);
		this.container.appendChild(this.mainBodyDom);
		this.container.appendChild(this.statusBarDom);

		this.mainBodyDom.appendChild(this.activityBarDom);
		this.mainBodyDom.appendChild(this.sideBarDom);
		
		const centerContainer = $<HTMLElement>('div', 'dc-part-center');
		centerContainer.appendChild(this.editorPartDom);
		centerContainer.appendChild(this.panelPartDom);
		this.mainBodyDom.appendChild(centerContainer);

		parentDom.appendChild(this.container);
		this._applyStyles();
	}

	private _applyStyles(): void {
		this.container.style.cssText = 'display:flex;flex-direction:column;width:100vw;height:100vh;overflow:hidden;background:#1e1e1e;color:#cccccc;font-family:Segoe UI, sans-serif;';
		this.titleBarDom.style.cssText = 'height:30px;background:#323233;display:flex;align-items:center;padding:0 10px;font-size:12px;user-select:none;border-bottom:1px solid #2b2b2b;';
		this.mainBodyDom.style.cssText = 'flex:1;display:flex;overflow:hidden;';
		this.activityBarDom.style.cssText = 'width:48px;background:#333333;display:flex;flex-direction:column;align-items:center;padding-top:10px;border-right:1px solid #252526;';
		this.sideBarDom.style.cssText = 'width:260px;background:#252526;border-right:1px solid #1e1e1e;display:flex;flex-direction:column;';
		this.statusBarDom.style.cssText = 'height:22px;background:#007acc;color:#ffffff;display:flex;align-items:center;padding:0 10px;font-size:12px;user-select:none;';
		
		const centerContainer = this.editorPartDom.parentElement!;
		centerContainer.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';
		this.editorPartDom.style.cssText = 'flex:1;position:relative;';
		this.panelPartDom.style.cssText = 'height:200px;background:#1e1e1e;border-top:1px solid #2b2b2b;';
	}
}

/**
 * Dardcor Code - Accordion View Container Inside Sidebar
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $, clearNode } from '../../../core/dom/element';

export interface ISidebarViewSection {
	readonly id: string;
	readonly title: string;
	readonly icon?: string;
	readonly content: HTMLElement;
	expanded?: boolean;
}

export interface ISidebarViewSectionChange {
	readonly id: string;
	readonly expanded: boolean;
}

export class SidebarViewContainer extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _sections = new Map<string, HTMLElement>();
	private readonly _sectionStates = new Map<string, boolean>();
	private _expandedId: string | null = null;

	private readonly _onDidChangeSection = this._register(new Emitter<ISidebarViewSectionChange>());
	readonly onDidChangeSection: Event<ISidebarViewSectionChange> = this._onDidChangeSection.event;

	constructor(parent: HTMLElement) {
		super();
		this._container = $<HTMLElement>('div', 'dc-sidebar-view-container');
		this._container.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;flex:1;';
		parent.appendChild(this._container);
	}

	get element(): HTMLElement {
		return this._container;
	}

	addSection(section: ISidebarViewSection): void {
		if (this._sections.has(section.id)) {
			return;
		}
		const expanded = section.expanded ?? true;
		const wrapper = $<HTMLElement>('div', 'dc-sidebar-section');
		wrapper.style.cssText = 'display:flex;flex-direction:column;border-bottom:1px solid #1e1e1e;';

		const header = $<HTMLElement>('div', 'dc-sidebar-section-header');
		header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:pointer;user-select:none;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#bbbbbb;background:#252526;';
		header.addEventListener('click', () => this.toggleSection(section.id));

		const chevron = $<HTMLElement>('span', 'dc-sidebar-section-chevron');
		chevron.textContent = expanded ? '\u25be' : '\u25b8';
		chevron.style.cssText = 'width:10px;font-size:9px;color:#858585;';
		const title = $<HTMLElement>('span', 'dc-sidebar-section-title');
		title.textContent = section.title;
		title.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		header.appendChild(chevron);
		if (section.icon) {
			const icon = $<HTMLElement>('span', 'dc-sidebar-section-icon');
			icon.textContent = section.icon;
			icon.style.cssText = 'font-size:13px;';
			header.appendChild(icon);
		}
		header.appendChild(title);
		wrapper.appendChild(header);

		const body = $<HTMLElement>('div', 'dc-sidebar-section-body');
		body.style.cssText = 'overflow-y:auto;overflow-x:hidden;flex:1;';
		body.appendChild(section.content);
		wrapper.appendChild(body);

		this._sections.set(section.id, wrapper);
		this._sectionStates.set(section.id, expanded);
		this._container.appendChild(wrapper);

		if (expanded) {
			if (this._expandedId && this._expandedId !== section.id) {
				this._applyExpanded(this._expandedId, false);
			}
			this._expandedId = section.id;
		}
		this._applyExpanded(section.id, expanded);
	}

	removeSection(id: string): void {
		const wrapper = this._sections.get(id);
		if (!wrapper) {
			return;
		}
		wrapper.remove();
		this._sections.delete(id);
		this._sectionStates.delete(id);
		if (this._expandedId === id) {
			this._expandedId = null;
		}
	}

	clear(): void {
		clearNode(this._container);
		this._sections.clear();
		this._sectionStates.clear();
		this._expandedId = null;
	}

	isSectionExpanded(id: string): boolean {
		return this._sectionStates.get(id) ?? false;
	}

	toggleSection(id: string): void {
		this._applyExpanded(id, !this.isSectionExpanded(id));
	}

	expandSection(id: string): void {
		this._applyExpanded(id, true);
	}

	collapseSection(id: string): void {
		this._applyExpanded(id, false);
	}

	private _applyExpanded(id: string, expanded: boolean): void {
		const wrapper = this._sections.get(id);
		if (!wrapper) {
			return;
		}
		this._sectionStates.set(id, expanded);
		const header = wrapper.firstElementChild as HTMLElement;
		const chevron = header?.firstElementChild as HTMLElement | null;
		const body = wrapper.lastElementChild as HTMLElement;
		if (chevron) {
			chevron.textContent = expanded ? '\u25be' : '\u25b8';
		}
		body.style.display = expanded ? 'block' : 'none';

		if (expanded) {
			if (this._expandedId && this._expandedId !== id) {
				const prev = this._sections.get(this._expandedId);
				const prevBody = prev?.lastElementChild as HTMLElement | null;
				const prevChevron = prev?.firstElementChild?.firstElementChild as HTMLElement | null;
				if (prevBody) {
					prevBody.style.display = 'none';
				}
				if (prevChevron) {
					prevChevron.textContent = '\u25b8';
				}
				this._sectionStates.set(this._expandedId, false);
			}
			this._expandedId = id;
		} else if (this._expandedId === id) {
			this._expandedId = null;
		}
		this._onDidChangeSection.fire({ id, expanded });
	}

	dispose(): void {
		this._container.remove();
		super.dispose();
	}
}

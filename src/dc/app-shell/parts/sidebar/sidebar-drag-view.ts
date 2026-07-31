/**
 * Dardcor Code - Drag View Section Between Containers Capability
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { $ } from '../../../core/dom/element.js';
import { SidebarViewContainer, ISidebarViewSection } from './sidebar-view-container.js';

export interface IDragViewSection {
	readonly id: string;
	readonly title: string;
	readonly icon?: string;
	readonly content: HTMLElement;
	readonly sourceContainer: SidebarViewContainer;
	readonly expanded: boolean;
}

export interface ISidebarDragEvent {
	readonly sectionId: string;
	readonly from: SidebarViewContainer;
	readonly to: SidebarViewContainer;
}

const DRAG_FORMAT = 'application/x-dc-sidebar-view';

export class SidebarDragView extends Disposable {
	private readonly _containers: SidebarViewContainer[];
	private readonly _sections = new Map<string, IDragViewSection>();
	private _dragOverContainer: SidebarViewContainer | null = null;

	private readonly _onDidMoveSection = this._register(new Emitter<ISidebarDragEvent>());
	readonly onDidMoveSection: Event<ISidebarDragEvent> = this._onDidMoveSection.event;

	constructor(containers: SidebarViewContainer[]) {
		super();
		this._containers = containers;
		for (const container of containers) {
			this._enableDropTarget(container);
		}
	}

	registerSection(container: SidebarViewContainer, section: ISidebarViewSection): void {
		this._sections.set(section.id, {
			id: section.id,
			title: section.title,
			icon: section.icon,
			content: section.content,
			sourceContainer: container,
			expanded: section.expanded ?? true,
		});
		this._makeSectionDraggable(container, section.id);
	}

	unregisterSection(sectionId: string): void {
		this._sections.delete(sectionId);
	}

	moveSection(sectionId: string, target: SidebarViewContainer): boolean {
		const section = this._sections.get(sectionId);
		if (!section) {
			return false;
		}
		if (section.sourceContainer === target) {
			return false;
		}
		section.sourceContainer.removeSection(sectionId);
		target.addSection({
			id: section.id,
			title: section.title,
			icon: section.icon,
			content: section.content,
			expanded: section.expanded,
		});
		this._sections.set(sectionId, { ...section, sourceContainer: target });
		this._makeSectionDraggable(target, sectionId);
		this._onDidMoveSection.fire({ sectionId, from: section.sourceContainer, to: target });
		return true;
	}

	getRegisteredSections(): string[] {
		return Array.from(this._sections.keys());
	}

	private _makeSectionDraggable(container: SidebarViewContainer, sectionId: string): void {
		const section = this._sections.get(sectionId);
		if (!section) {
			return;
		}
		const wrappers = Array.from(container.element.querySelectorAll('.dc-sidebar-section'));
		const wrapper = wrappers.find(w => w.lastElementChild?.contains(section.content));
		const header = wrapper?.firstElementChild as HTMLElement | null;
		if (!header) {
			return;
		}
		header.draggable = true;
		header.style.cursor = 'grab';

		header.addEventListener('dragstart', (e: DragEvent) => {
			e.dataTransfer?.setData(DRAG_FORMAT, sectionId);
			e.dataTransfer?.setData('text/plain', sectionId);
			e.dataTransfer!.effectAllowed = 'move';
			header.style.opacity = '0.5';
		});
		header.addEventListener('dragend', () => {
			header.style.opacity = '1';
			this._dragOverContainer = null;
			this._clearDropHighlights();
		});
	}

	private _enableDropTarget(container: SidebarViewContainer): void {
		const el = container.element;
		el.addEventListener('dragover', (e: DragEvent) => {
			if (!e.dataTransfer?.types.includes(DRAG_FORMAT)) {
				return;
			}
			e.preventDefault();
			e.dataTransfer.dropEffect = 'move';
			if (this._dragOverContainer !== container) {
				this._dragOverContainer = container;
				this._clearDropHighlights();
				el.style.outline = '2px dashed #007acc';
				el.style.outlineOffset = '-2px';
			}
		});
		el.addEventListener('dragleave', (e: DragEvent) => {
			if (!el.contains(e.relatedTarget as Node | null)) {
				this._dragOverContainer = null;
				this._clearDropHighlights();
			}
		});
		el.addEventListener('drop', (e: DragEvent) => {
			const sectionId = e.dataTransfer?.getData(DRAG_FORMAT);
			if (!sectionId) {
				return;
			}
			e.preventDefault();
			this._dragOverContainer = null;
			this._clearDropHighlights();
			this.moveSection(sectionId, container);
		});
	}

	private _clearDropHighlights(): void {
		for (const container of this._containers) {
			container.element.style.outline = '';
		}
	}

	dispose(): void {
		this._sections.clear();
		this._containers.length = 0;
		super.dispose();
	}
}

export function addSectionDragHandle(header: HTMLElement): HTMLElement {
	const handle = $<HTMLElement>('span', 'dc-sidebar-drag-handle');
	handle.textContent = '\u2630';
	handle.title = 'Drag to move section';
	handle.style.cssText = 'cursor:grab;color:#6a6a6a;font-size:11px;padding:0 4px;flex-shrink:0;user-select:none;';
	handle.addEventListener('mousedown', (e: MouseEvent) => {
		e.stopPropagation();
		header.draggable = true;
	});
	header.appendChild(handle);
	return handle;
}

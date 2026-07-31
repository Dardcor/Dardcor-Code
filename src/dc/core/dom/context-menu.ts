/**
 * Dardcor Code - Context Menu Positioning (Task 94)
 * Mirrors: vs/base/browser/ui/contextview/contextview.ts
 */

export interface IAnchor {
	x: number;
	y: number;
	width?: number;
	height?: number;
}

export interface ILayoutInfo {
	top: number;
	left: number;
	maxHeight: number;
	maxWidth: number;
}

export function layoutContextMenu(anchor: IAnchor, menuWidth: number, menuHeight: number, viewportWidth: number, viewportHeight: number): ILayoutInfo {
	let left = anchor.x;
	let top = anchor.y + (anchor.height ?? 0);
	// Flip horizontal if overflowing right
	if (left + menuWidth > viewportWidth) {
		left = Math.max(0, anchor.x - menuWidth + (anchor.width ?? 0));
	}
	// Flip vertical if overflowing bottom
	if (top + menuHeight > viewportHeight) {
		top = Math.max(0, anchor.y - menuHeight);
	}
	const maxHeight = Math.min(menuHeight, viewportHeight - top - 10);
	const maxWidth = Math.min(menuWidth, viewportWidth - left - 10);
	return { top, left, maxHeight, maxWidth };
}

export function getAnchorFromElement(el: HTMLElement): IAnchor {
	const rect = el.getBoundingClientRect();
	return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

export function getAnchorFromMouseEvent(e: MouseEvent): IAnchor {
	return { x: e.clientX, y: e.clientY, width: 0, height: 0 };
}

import { BrowserWindow, screen, Rectangle } from 'electron';

export type WindowAlignment = 'left-half' | 'right-half' | 'top-half' | 'bottom-half' | 'center' | 'maximize' | 'restore' | 'fill' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface WorkspaceBounds {
	workArea: Rectangle;
	displayId: number;
}

export function getWorkspaceBounds(window: BrowserWindow): WorkspaceBounds {
	const bounds = window.isDestroyed() ? { x: 0, y: 0, width: 800, height: 600 } : window.getBounds();
	const display = screen.getDisplayMatching(bounds);
	return { workArea: display.workArea, displayId: display.id };
}

export function getAlignmentBounds(window: BrowserWindow, alignment: WindowAlignment): Rectangle {
	const { workArea } = getWorkspaceBounds(window);
	switch (alignment) {
		case 'left-half':
			return { x: workArea.x, y: workArea.y, width: Math.floor(workArea.width / 2), height: workArea.height };
		case 'right-half':
			return { x: workArea.x + Math.floor(workArea.width / 2), y: workArea.y, width: Math.ceil(workArea.width / 2), height: workArea.height };
		case 'top-half':
			return { x: workArea.x, y: workArea.y, width: workArea.width, height: Math.floor(workArea.height / 2) };
		case 'bottom-half':
			return { x: workArea.x, y: workArea.y + Math.floor(workArea.height / 2), width: workArea.width, height: Math.ceil(workArea.height / 2) };
		case 'top-left':
			return { x: workArea.x, y: workArea.y, width: Math.floor(workArea.width / 2), height: Math.floor(workArea.height / 2) };
		case 'top-right':
			return { x: workArea.x + Math.floor(workArea.width / 2), y: workArea.y, width: Math.ceil(workArea.width / 2), height: Math.floor(workArea.height / 2) };
		case 'bottom-left':
			return { x: workArea.x, y: workArea.y + Math.floor(workArea.height / 2), width: Math.floor(workArea.width / 2), height: Math.ceil(workArea.height / 2) };
		case 'bottom-right':
			return { x: workArea.x + Math.floor(workArea.width / 2), y: workArea.y + Math.floor(workArea.height / 2), width: Math.ceil(workArea.width / 2), height: Math.ceil(workArea.height / 2) };
		case 'center': {
			const width = Math.min(workArea.width - 120, 1200);
			const height = Math.min(workArea.height - 120, 800);
			return { x: workArea.x + Math.floor((workArea.width - width) / 2), y: workArea.y + Math.floor((workArea.height - height) / 2), width, height };
		}
		case 'fill':
			return { ...workArea };
		default:
			return { ...workArea };
	}
}

export function alignWindowToWorkspace(window: BrowserWindow, alignment: WindowAlignment): boolean {
	if (window.isDestroyed()) {
		return false;
	}
	try {
		if (alignment === 'maximize') {
			window.maximize();
			return true;
		}
		if (alignment === 'restore') {
			window.unmaximize();
			window.restore();
			return true;
		}
		window.setBounds(getAlignmentBounds(window, alignment));
		return true;
	} catch (err) {
		console.warn('[screen-workspace-align] align failed:', err);
		return false;
	}
}

export function alignWindowToGrid(window: BrowserWindow, columns: number, rows: number, column: number, row: number): boolean {
	if (columns < 1 || rows < 1 || column < 0 || column >= columns || row < 0 || row >= rows) {
		return false;
	}
	const { workArea } = getWorkspaceBounds(window);
	const width = Math.floor(workArea.width / columns);
	const height = Math.floor(workArea.height / rows);
	const bounds: Rectangle = {
		x: workArea.x + column * width,
		y: workArea.y + row * height,
		width,
		height
	};
	try {
		window.setBounds(bounds);
		return true;
	} catch (err) {
		console.warn('[screen-workspace-align] grid align failed:', err);
		return false;
	}
}

export function moveWindowToDisplay(window: BrowserWindow, displayId: number): boolean {
	const display = screen.getAllDisplays().find((d) => d.id === displayId);
	if (!display || window.isDestroyed()) {
		return false;
	}
	try {
		const bounds = window.getBounds();
		const target: Rectangle = {
			x: display.workArea.x + Math.floor((display.workArea.width - bounds.width) / 2),
			y: display.workArea.y + Math.floor((display.workArea.height - bounds.height) / 2),
			width: bounds.width,
			height: bounds.height
		};
		window.setBounds(target);
		return true;
	} catch {
		return false;
	}
}

export function getGridCellBounds(window: BrowserWindow, columns: number, rows: number, column: number, row: number): Rectangle | null {
	if (columns < 1 || rows < 1 || column < 0 || column >= columns || row < 0 || row >= rows) {
		return null;
	}
	const { workArea } = getWorkspaceBounds(window);
	return {
		x: workArea.x + column * Math.floor(workArea.width / columns),
		y: workArea.y + row * Math.floor(workArea.height / rows),
		width: Math.floor(workArea.width / columns),
		height: Math.floor(workArea.height / rows)
	};
}

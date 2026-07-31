/**
 * Dardcor Code - Native Window Manager
 */

export class WindowManager {
	private static _windows: any[] = [];

	public static createWindow(options: { width?: number; height?: number; title?: string } = {}): any {
		const win = {
			id: this._windows.length + 1,
			title: options.title || 'Dardcor Code',
			width: options.width || 1280,
			height: options.height || 800,
			focus: () => {},
			close: () => {}
		};
		this._windows.push(win);
		return win;
	}

	public static getWindows(): any[] {
		return this._windows;
	}
}

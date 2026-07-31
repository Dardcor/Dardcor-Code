import { Menu, MenuItemConstructorOptions } from 'electron';

export interface TrayMenuItem {
	label: string;
	click?: () => void;
	type?: 'normal' | 'separator' | 'checkbox' | 'radio';
	checked?: boolean;
	enabled?: boolean;
	accelerator?: string;
	toolTip?: string;
	submenu?: TrayMenuItem[];
	role?: string;
}

export function buildTrayMenu(items: TrayMenuItem[]): Menu {
	const template: MenuItemConstructorOptions[] = items.map((item) => {
		const entry: MenuItemConstructorOptions = {
			label: item.type === 'separator' ? undefined : item.label,
			type: item.type,
			enabled: item.enabled,
			checked: item.checked,
			accelerator: item.accelerator,
			toolTip: item.toolTip,
			role: item.role as any
		};
		if (item.click) {
			entry.click = () => item.click?.();
		}
		if (item.submenu) {
			entry.submenu = buildTrayMenu(item.submenu);
		}
		return entry;
	});
	return Menu.buildFromTemplate(template);
}

export function defaultTrayMenu(callbacks: { showWindow: () => void; quit: () => void }): Menu {
	return buildTrayMenu([
		{
			label: 'Show Dardcor Code',
			click: () => callbacks.showWindow()
		},
		{ type: 'separator' },
		{
			label: 'Quit',
			click: () => callbacks.quit()
		}
	]);
}

export function buildStatusTrayMenu(status: string, callbacks: { showWindow: () => void; quit: () => void }): Menu {
	return buildTrayMenu([
		{
			label: `Status: ${status}`,
			enabled: false
		},
		{ type: 'separator' },
		{
			label: 'Show Dardcor Code',
			click: () => callbacks.showWindow()
		},
		{ type: 'separator' },
		{
			label: 'Quit',
			click: () => callbacks.quit()
		}
	]);
}

export function buildRecentFilesTrayMenu(recentFiles: string[], callbacks: { showWindow: () => void; quit: () => void; openFile?: (filePath: string) => void }): Menu {
	const recentItems: TrayMenuItem[] = recentFiles.slice(0, 5).map((filePath) => ({
		label: filePath,
		click: () => callbacks.openFile?.(filePath)
	}));
	const items: TrayMenuItem[] = [
		{
			label: 'Show Dardcor Code',
			click: () => callbacks.showWindow()
		}
	];
	if (recentItems.length > 0) {
		items.push({ type: 'separator' });
		items.push({ label: 'Recent Files', enabled: false });
		items.push(...recentItems);
	}
	items.push({ type: 'separator' });
	items.push({
		label: 'Quit',
		click: () => callbacks.quit()
	});
	return buildTrayMenu(items);
}

export function getTrayMenuInstance(menu: Menu): Menu {
	return menu;
}

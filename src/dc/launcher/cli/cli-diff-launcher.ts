import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function launchDiff(left: string, right: string): Promise<void> {
	let electron: any = null;
	try {
		electron = await import('electron');
	} catch {
		electron = null;
	}
	if (!electron || typeof electron === 'string' || !electron.BrowserWindow) {
		process.stderr.write(`Cannot open diff in CLI mode: the desktop app is not available.\n`);
		return;
	}
	try {
		const projectRoot = new URL('../../../../', import.meta.url).pathname.replace(/^[/\\]/, '');
		const entry = pathToFileURL(join(projectRoot, 'src', 'dc', 'code', 'electron-sandbox', 'workbench', 'workbench.html')).toString();
		const diffQuery = `${encodeURIComponent(left)}|${encodeURIComponent(right)}`;
		const win = new electron.BrowserWindow({
			width: 1280,
			height: 800,
			title: 'Diff - Dardcor Code',
			webPreferences: {
				nodeIntegration: true,
				contextIsolation: false
			}
		});
		await win.loadURL(`${entry}?diff=${diffQuery}`);
	} catch (err: any) {
		process.stderr.write(`Failed to open diff window: ${err?.message ?? String(err)}\n`);
	}
}

import { app, dialog, BrowserWindow } from 'electron';

export const UPDATED_ARG = '--updated';

export function relaunchToUpdate(extraArgs: string[] = []): void {
	const args = [...process.argv.slice(1), UPDATED_ARG, ...extraArgs];
	try {
		app.relaunch({ args });
	} catch (err) {
		console.error('[update-relauncher] relaunch failed:', err);
	}
	app.exit(0);
}

export function isRelaunchedWithUpdatedArg(): boolean {
	return process.argv.includes(UPDATED_ARG);
}

export async function confirmRelaunch(window?: BrowserWindow | null): Promise<boolean> {
	const parent = window && !window.isDestroyed() ? window : undefined;
	const result = parent
		? await dialog.showMessageBox(parent, {
			type: 'question',
			title: 'Dardcor Code',
			message: 'The application must restart to apply the update.',
			detail: 'Do you want to restart now?',
			buttons: ['Restart', 'Later'],
			defaultId: 0,
			cancelId: 1,
			noLink: true
		})
		: await dialog.showMessageBox({
			type: 'question',
			title: 'Dardcor Code',
			message: 'The application must restart to apply the update.',
			detail: 'Do you want to restart now?',
			buttons: ['Restart', 'Later'],
			defaultId: 0,
			cancelId: 1,
			noLink: true
		});
	return result.response === 0;
}

export async function confirmAndRelaunch(window?: BrowserWindow | null): Promise<boolean> {
	const confirmed = await confirmRelaunch(window);
	if (confirmed) {
		relaunchToUpdate();
	}
	return confirmed;
}

export function relaunchApp(extraArgs: string[] = []): void {
	const args = [...process.argv.slice(1), ...extraArgs];
	try {
		app.relaunch({ args });
	} catch (err) {
		console.error('[update-relauncher] relaunch failed:', err);
	}
	app.exit(0);
}

export function getUpdatedArg(): string {
	return UPDATED_ARG;
}

export function wasLaunchedForUpdate(): boolean {
	return isRelaunchedWithUpdatedArg();
}

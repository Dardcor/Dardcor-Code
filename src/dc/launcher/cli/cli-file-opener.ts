import { getElectronIPC } from '../../core/ipc/electron-bridge';

export class CLIFileOpener {
	public openInRunningInstance(paths: string[]): boolean {
		if (!paths || paths.length === 0) {
			return false;
		}
		try {
			const ipc = getElectronIPC();
			if (!ipc.isAvailable) {
				return false;
			}
			ipc.send('vscode:open', paths);
			return true;
		} catch {
			return false;
		}
	}
}

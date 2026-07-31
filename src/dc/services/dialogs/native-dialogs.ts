/**
 * Dardcor Code - Native Dialogs (Task 165)
 * Mirrors: vs/platform/dialogs/node/dialogs.ts (OS native dialog bindings)
 */

export interface IOpenDialogOptions {
	title?: string;
	defaultPath?: string;
	buttonLabel?: string;
	filters?: Array<{ name: string; extensions: string[] }>;
	properties?: Array<'openFile' | 'openDirectory' | 'multiSelections'>;
}

export interface ISaveDialogOptions {
	title?: string;
	defaultPath?: string;
	buttonLabel?: string;
	filters?: Array<{ name: string; extensions: string[] }>;
}

export class NativeDialogService {
	async showOpenDialog(options: IOpenDialogOptions): Promise<string[] | undefined> {
		const dialog = await this._getDialog();
		if (!dialog) {
			return undefined;
		}
		try {
			const result = await dialog.showOpenDialog(options);
			if (result?.canceled) {
				return undefined;
			}
			return result?.filePaths;
		} catch {
			return undefined;
		}
	}

	async showSaveDialog(options: ISaveDialogOptions): Promise<string | undefined> {
		const dialog = await this._getDialog();
		if (!dialog) {
			return undefined;
		}
		try {
			const result = await dialog.showSaveDialog(options);
			if (result?.canceled) {
				return undefined;
			}
			return result?.filePath;
		} catch {
			return undefined;
		}
	}

	private async _getDialog(): Promise<any | undefined> {
		try {
			const electron: any = await import('electron');
			return electron?.dialog ?? electron?.remote?.dialog;
		} catch {
			return undefined;
		}
	}
}

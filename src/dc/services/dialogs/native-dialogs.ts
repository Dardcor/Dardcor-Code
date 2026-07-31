/**
 * Dardcor Code - Native Dialogs (Task 165)
 * Mirrors: vs/platform/dialogs/node/dialogs.ts OS native dialog bindings
 */

declare const require: any;

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
		try {
			const { dialog } = require('electron').remote || require('electron');
			const res = await dialog.showOpenDialog(options);
			if (res.canceled) return undefined;
			return res.filePaths;
		} catch {
			return undefined;
		}
	}

	async showSaveDialog(options: ISaveDialogOptions): Promise<string | undefined> {
		try {
			const { dialog } = require('electron').remote || require('electron');
			const res = await dialog.showSaveDialog(options);
			if (res.canceled) return undefined;
			return res.filePath;
		} catch {
			return undefined;
		}
	}
}

/**
 * Dardcor Code - System Clipboard Access (Task 69)
 * Mirrors: vs/platform/clipboard/common/clipboardService.ts
 */

export interface IClipboardService {
	writeText(text: string): Promise<void>;
	readText(): Promise<string>;
	writeResources(resources: string[]): Promise<void>;
	readResources(): Promise<string[]>;
	hasResources(): Promise<boolean>;
}

export class BrowserClipboardService implements IClipboardService {
	private _resources: string[] = [];

	async writeText(text: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// Fallback for older browsers
			const textarea = document.createElement('textarea');
			textarea.value = text;
			textarea.style.position = 'fixed';
			textarea.style.opacity = '0';
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand('copy');
			document.body.removeChild(textarea);
		}
	}

	async readText(): Promise<string> {
		try {
			return await navigator.clipboard.readText();
		} catch {
			return '';
		}
	}

	async writeResources(resources: string[]): Promise<void> {
		this._resources = [...resources];
	}

	async readResources(): Promise<string[]> {
		return [...this._resources];
	}

	async hasResources(): Promise<boolean> {
		return this._resources.length > 0;
	}
}

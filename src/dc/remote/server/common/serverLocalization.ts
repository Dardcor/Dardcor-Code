import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerLanguagePackItem {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly extensionId?: string;
	readonly isInstalled: boolean;
}

export interface IServerLocalizationService {
	readonly onDidChangeLanguage: Event<string>;
	readonly onDidInstallLanguagePack: Event<IServerLanguagePackItem>;
	readonly onDidUninstallLanguagePack: Event<string>;
	getLanguage(): string;
	setLanguage(language: string): Promise<void>;
	getLanguagePacks(): IServerLanguagePackItem[];
	installLanguagePack(id: string): Promise<void>;
	uninstallLanguagePack(id: string): Promise<void>;
	clearLanguage(): Promise<void>;
}

export class ServerLocalizationCommon implements IServerLocalizationService {
	private _currentLanguage = 'en';
	private readonly _languagePacks = new Map<string, IServerLanguagePackItem>();

	private readonly _onDidChangeLanguage = new Emitter<string>();
	readonly onDidChangeLanguage = this._onDidChangeLanguage.event;

	private readonly _onDidInstallLanguagePack = new Emitter<IServerLanguagePackItem>();
	readonly onDidInstallLanguagePack = this._onDidInstallLanguagePack.event;

	private readonly _onDidUninstallLanguagePack = new Emitter<string>();
	readonly onDidUninstallLanguagePack = this._onDidUninstallLanguagePack.event;

	constructor() {
		this._languagePacks.set('en', { id: 'en', label: 'English', isInstalled: true });
	}

	getLanguage(): string {
		return this._currentLanguage;
	}

	async setLanguage(language: string): Promise<void> {
		if (this._currentLanguage !== language) {
			this._currentLanguage = language;
			this._onDidChangeLanguage.fire(language);
		}
	}

	getLanguagePacks(): IServerLanguagePackItem[] {
		return Array.from(this._languagePacks.values());
	}

	async installLanguagePack(id: string): Promise<void> {
		if (!this._languagePacks.has(id)) {
			const pack: IServerLanguagePackItem = { id, label: id, isInstalled: true };
			this._languagePacks.set(id, pack);
			this._onDidInstallLanguagePack.fire(pack);
		} else {
			const pack = this._languagePacks.get(id)!;
			if (!pack.isInstalled) {
				const installedPack = { ...pack, isInstalled: true };
				this._languagePacks.set(id, installedPack);
				this._onDidInstallLanguagePack.fire(installedPack);
			}
		}
	}

	async uninstallLanguagePack(id: string): Promise<void> {
		if (id === 'en') return; // Cannot uninstall default
		if (this._languagePacks.has(id)) {
			this._languagePacks.delete(id);
			this._onDidUninstallLanguagePack.fire(id);
			if (this._currentLanguage === id) {
				await this.setLanguage('en');
			}
		}
	}

	async clearLanguage(): Promise<void> {
		await this.setLanguage('en');
	}
}

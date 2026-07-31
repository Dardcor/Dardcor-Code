/**
 * Dardcor Code - Reset Setting to Default Inline Action Command
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $ } from '../../core/dom/element';
import { IConfigurationService, ConfigurationService } from '../../services/configuration/configuration-service';
import { DEFAULT_SETTINGS, ISettingDescriptor } from './settings-editor';

export interface ISettingsResetEvent {
	readonly settingKey: string;
	readonly defaultValue: unknown;
}

export class SettingsReset extends Disposable {
	private readonly _onDidReset = this._register(new Emitter<ISettingsResetEvent>());
	readonly onDidReset: Event<ISettingsResetEvent> = this._onDidReset.event;

	private readonly _configurationService: IConfigurationService;

	constructor(configurationService?: IConfigurationService) {
		super();
		this._configurationService = configurationService ?? new ConfigurationService();
	}

	public static getDefaultValue(settingKey: string): unknown {
		const descriptor = DEFAULT_SETTINGS.find(s => s.key === settingKey);
		return descriptor ? descriptor.defaultValue : undefined;
	}

	public static findDescriptor(settingKey: string): ISettingDescriptor | undefined {
		return DEFAULT_SETTINGS.find(s => s.key === settingKey);
	}

	public isModified(settingKey: string): boolean {
		const current = this._configurationService.getValue<any>(settingKey);
		const defaultValue = SettingsReset.getDefaultValue(settingKey);
		return current !== undefined && JSON.stringify(current) !== JSON.stringify(defaultValue);
	}

	public getModifiedKeys(): string[] {
		const keys: string[] = [];
		for (const descriptor of DEFAULT_SETTINGS) {
			if (this.isModified(descriptor.key)) {
				keys.push(descriptor.key);
			}
		}
		return keys;
	}

	public async reset(settingKey: string): Promise<boolean> {
		const defaultValue = SettingsReset.getDefaultValue(settingKey);
		if (defaultValue === undefined) {
			return false;
		}
		await this._configurationService.updateValue(settingKey, defaultValue);
		this._onDidReset.fire({ settingKey, defaultValue });
		return true;
	}

	public async resetAll(): Promise<void> {
		for (const key of this.getModifiedKeys()) {
			await this.reset(key);
		}
	}

	public createResetButton(settingKey: string): HTMLButtonElement {
		const button = $<HTMLButtonElement>('button');
		button.textContent = '\u21BA';
		button.title = 'Reset ke Nilai Default';
		button.style.cssText = 'background:transparent;border:none;color:#8a8a8a;cursor:pointer;font-size:12px;padding:2px 4px;';
		button.style.display = this.isModified(settingKey) ? 'inline-block' : 'none';
		button.addEventListener('click', () => {
			void this.reset(settingKey);
		});
		this._register(this._configurationService.onDidChangeConfiguration(() => {
			button.style.display = this.isModified(settingKey) ? 'inline-block' : 'none';
		}));
		return button;
	}
}

/**
 * Dardcor Code - Configuration Service Interface & Implementation
 */

import { createDecorator } from '../instantiation/annotations';
import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';

export const IConfigurationService = createDecorator<IConfigurationService>('configurationService');

export interface ConfigurationChangeEvent {
	affectsConfiguration(section: string): boolean;
}

export interface IConfigurationService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeConfiguration: Event<ConfigurationChangeEvent>;
	getValue<T>(section?: string): T;
	updateValue(key: string, value: any): Promise<void>;
}

export class ConfigurationService extends Disposable implements IConfigurationService {
	declare readonly _serviceBrand: undefined;

	private _config: Record<string, any> = {
		'editor.fontSize': 14,
		'editor.tabSize': 4,
		'editor.insertSpaces': true,
		'workbench.colorTheme': 'Dark Modern',
		'terminal.integrated.shell': 'powershell.exe'
	};

	private readonly _onDidChangeConfiguration = this._register(new Emitter<ConfigurationChangeEvent>());
	readonly onDidChangeConfiguration = this._onDidChangeConfiguration.event;

	public getValue<T>(section?: string): T {
		if (!section) {
			return this._config as unknown as T;
		}
		return this._config[section] as T;
	}

	public async updateValue(key: string, value: any): Promise<void> {
		this._config[key] = value;
		this._onDidChangeConfiguration.fire({
			affectsConfiguration: (sec: string) => key.startsWith(sec)
		});
	}
}

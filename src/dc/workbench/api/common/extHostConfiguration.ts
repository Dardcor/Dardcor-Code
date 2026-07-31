import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostConfiguration {
	private _configuration: any = {};
	
	private readonly _onDidChangeConfiguration = new Emitter<void>();
	readonly onDidChangeConfiguration = this._onDidChangeConfiguration.event;

	getConfiguration(section?: string, resource?: any): any {
		if (section) {
			const parts = section.split('.');
			let current = this._configuration;
			for (const part of parts) {
				if (current && typeof current === 'object' && part in current) {
					current = current[part];
				} else {
					return undefined;
				}
			}
			return current;
		}
		return this._configuration;
	}

	$acceptConfigurationChanged(data: any): void {
		this._configuration = data;
		this._onDidChangeConfiguration.fire();
	}
}

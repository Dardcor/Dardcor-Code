import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostEnvironmentVariable {
	private readonly _mutators = new Map<string, any>();
	
	readonly onDidChange = new Emitter<any>().event;

	replace(variable: string, value: string): void {
		this._mutators.set(variable, { type: 'replace', value });
	}

	append(variable: string, value: string): void {
		this._mutators.set(variable, { type: 'append', value });
	}

	prepend(variable: string, value: string): void {
		this._mutators.set(variable, { type: 'prepend', value });
	}

	get(variable: string): any {
		return this._mutators.get(variable);
	}

	clear(): void {
		this._mutators.clear();
	}
}

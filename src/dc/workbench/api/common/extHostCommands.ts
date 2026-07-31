import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostCommands {
	private readonly _commands = new Map<string, (...args: any[]) => any>();

	registerCommand(id: string, callback: (...args: any[]) => any, thisArg?: any): IDisposable {
		if (!id.trim().length) {
			throw new Error('invalid id');
		}

		if (this._commands.has(id)) {
			throw new Error(`command '${id}' already exists`);
		}

		this._commands.set(id, callback.bind(thisArg));
		
		return {
			dispose: () => {
				this._commands.delete(id);
			}
		};
	}

	async executeCommand<T>(id: string, ...args: any[]): Promise<T> {
		if (this._commands.has(id)) {
			return this._commands.get(id)!(...args);
		}
		throw new Error(`command '${id}' not found`);
	}

	getCommands(): Promise<string[]> {
		return Promise.resolve(Array.from(this._commands.keys()));
	}
}

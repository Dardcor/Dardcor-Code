import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostOutputChannel {
	private _nextId = 1;

	createOutputChannel(name: string, options?: string | { log: true }): any {
		const id = `output-${this._nextId++}`;
		const isLog = typeof options === 'object' && options.log;
		
		const channel = {
			name,
			append: (value: string) => {
				console.log(`[Output ${name}]`, value);
			},
			appendLine: (value: string) => {
				console.log(`[Output ${name}]`, value);
			},
			replace: (value: string) => {
				console.log(`[Output ${name} REPLACED]`, value);
			},
			clear: () => {},
			show: (preserveFocus?: boolean | any) => {
				console.log(`Showing Output Channel ${name}`);
			},
			hide: () => {
				console.log(`Hiding Output Channel ${name}`);
			},
			dispose: () => {
				console.log(`Disposing Output Channel ${name}`);
			}
		};

		if (isLog) {
			Object.assign(channel, {
				logLevel: 3, // Info
				onDidChangeLogLevel: new Emitter<any>().event,
				trace: (message: string, ...args: any[]) => console.trace(message, ...args),
				debug: (message: string, ...args: any[]) => console.debug(message, ...args),
				info: (message: string, ...args: any[]) => console.info(message, ...args),
				warn: (message: string, ...args: any[]) => console.warn(message, ...args),
				error: (message: string | Error, ...args: any[]) => console.error(message, ...args)
			});
		}

		return channel;
	}
}

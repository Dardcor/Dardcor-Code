import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostSecretsProvider {
	async get(key: string): Promise<string | undefined> {
		return undefined;
	}

	async store(key: string, value: string): Promise<void> {}

	async delete(key: string): Promise<void> {}

	readonly onDidChange = new Emitter<any>().event;
}

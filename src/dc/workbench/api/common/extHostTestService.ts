import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostTestService {
	private readonly _controllers = new Map<string, any>();

	registerTestController(id: string, controller: any): IDisposable {
		this._controllers.set(id, controller);
		return { dispose: () => this._controllers.delete(id) };
	}
}

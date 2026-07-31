import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';
import { ExtHostTestService } from './extHostTestService';

export class ExtHostTestController {
	constructor(private readonly _service: ExtHostTestService) {}
	
	createTestController(id: string, label: string): any {
		const controller = {
			id,
			label,
			dispose: () => {}
		};
		this._service.registerTestController(id, controller);
		return controller;
	}
}

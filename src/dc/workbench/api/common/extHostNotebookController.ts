import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';
import { ExtHostNotebookKernel } from './extHostNotebookKernel';

export class ExtHostNotebookController {
	private readonly _controllers = new Map<string, any>();

	createNotebookController(id: string, notebookType: string, label: string, handler?: any, preloads?: any[]): any {
		const controller = new ExtHostNotebookKernel(id, notebookType, label);
		controller.executeHandler = handler;
		
		this._controllers.set(id, controller);
		
		const originalDispose = controller.dispose.bind(controller);
		controller.dispose = () => {
			this._controllers.delete(id);
			originalDispose();
		};

		return controller;
	}
}

import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostNotebookKernel {
	constructor(
		public readonly id: string,
		public readonly notebookType: string,
		public readonly label: string
	) {}

	public detail?: string;
	public description?: string;
	public supportedLanguages?: string[];
	public executeHandler?: (cells: any[], notebook: any, controller: any) => void | Thenable<void>;
	public interruptHandler?: (notebook: any) => void | Thenable<void>;

	public dispose(): void {}
}

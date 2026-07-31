import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';
import { ExtHostTextDocument } from './extHostTextDocument';

export class ExtHostTextEditor {
	constructor(
		public readonly document: ExtHostTextDocument,
		public readonly viewColumn: number | undefined
	) {}

	public selections: any[] = [];
	public options: any = {};
	
	edit(callback: (editBuilder: any) => void, options?: { undoStopBefore: boolean; undoStopAfter: boolean }): Promise<boolean> {
		return Promise.resolve(true);
	}
}

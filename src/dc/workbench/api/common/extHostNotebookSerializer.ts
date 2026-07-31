import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostNotebookSerializer {
	private readonly _serializers = new Map<string, any>();

	registerNotebookSerializer(notebookType: string, serializer: any, options?: any): IDisposable {
		this._serializers.set(notebookType, { serializer, options });
		return { dispose: () => this._serializers.delete(notebookType) };
	}
}

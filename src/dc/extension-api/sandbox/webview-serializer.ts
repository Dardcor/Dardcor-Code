import { IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';

export interface IWebviewSerializer {
	deserializeWebviewPanel(newWebview: any, state: any): void;
}

export class WebviewSerializerRegistry {
	private readonly _serializers = new Map<string, IWebviewSerializer>();

	public registerWebviewPanelSerializer(viewType: string, serializer: IWebviewSerializer): IDisposable {
		if (this._serializers.has(viewType)) {
			throw new Error(`Serializer sudah terdaftar untuk tipe: ${viewType}`);
		}
		this._serializers.set(viewType, serializer);
		return toDisposable(() => this._serializers.delete(viewType));
	}

	public hasSerializer(viewType: string): boolean {
		return this._serializers.has(viewType);
	}

	public deserializePanel(viewType: string, newWebview: any, state: any): void {
		const serializer = this._serializers.get(viewType);
		if (!serializer) {
			throw new Error(`Tidak ada serializer untuk tipe: ${viewType}`);
		}
		serializer.deserializeWebviewPanel(newWebview, state);
	}
}

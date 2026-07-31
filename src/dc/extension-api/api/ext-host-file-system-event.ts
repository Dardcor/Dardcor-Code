import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { URI } from '../../core/types/uri.js';

export class ExtHostFileSystemEvents extends Disposable {
	private readonly _onDidCreate = this._register(new Emitter<URI[]>());
	readonly onDidCreate: Event<URI[]> = this._onDidCreate.event;

	private readonly _onDidChange = this._register(new Emitter<URI[]>());
	readonly onDidChange: Event<URI[]> = this._onDidChange.event;

	private readonly _onDidDelete = this._register(new Emitter<URI[]>());
	readonly onDidDelete: Event<URI[]> = this._onDidDelete.event;

	public fireCreate(uris: URI[]): void {
		if (uris.length === 0) {
			return;
		}
		this._onDidCreate.fire(uris.slice());
	}

	public fireChange(uris: URI[]): void {
		if (uris.length === 0) {
			return;
		}
		this._onDidChange.fire(uris.slice());
	}

	public fireDelete(uris: URI[]): void {
		if (uris.length === 0) {
			return;
		}
		this._onDidDelete.fire(uris.slice());
	}

	public fireCreateOne(uri: URI): void {
		this.fireCreate([uri]);
	}

	public fireChangeOne(uri: URI): void {
		this.fireChange([uri]);
	}

	public fireDeleteOne(uri: URI): void {
		this.fireDelete([uri]);
	}

	public override dispose(): void {
		super.dispose();
	}
}

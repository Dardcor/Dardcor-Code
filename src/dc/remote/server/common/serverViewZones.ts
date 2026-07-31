import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerViewZone {
	readonly id: string;
	readonly afterLineNumber: number;
	readonly afterColumn?: number;
	readonly heightInLines?: number;
	readonly heightInPx?: number;
	readonly minWidthInPx?: number;
	readonly onDomNodeTop?: (top: number) => void;
	readonly onComputedHeight?: (height: number) => void;
}

export interface IServerViewZonesService {
	readonly onDidChangeViewZones: Event<{ uri: string; added: IServerViewZone[]; removed: string[] }>;
	addViewZones(uri: string, zones: Omit<IServerViewZone, 'id'>[]): string[];
	removeViewZones(uri: string, ids: string[]): void;
	getViewZones(uri: string): Promise<IServerViewZone[]>;
}

export class ServerViewZonesCommon implements IServerViewZonesService {
	private readonly _zones = new Map<string, IServerViewZone[]>();
	private _nextId = 1;

	private readonly _onDidChangeViewZones = new Emitter<{ uri: string; added: IServerViewZone[]; removed: string[] }>();
	readonly onDidChangeViewZones = this._onDidChangeViewZones.event;

	addViewZones(uri: string, zones: Omit<IServerViewZone, 'id'>[]): string[] {
		let uriZones = this._zones.get(uri);
		if (!uriZones) {
			uriZones = [];
			this._zones.set(uri, uriZones);
		}

		const added: IServerViewZone[] = [];
		const ids: string[] = [];

		for (const z of zones) {
			const id = `view-zone-${this._nextId++}`;
			const viewZone = { ...z, id };
			uriZones.push(viewZone);
			added.push(viewZone);
			ids.push(id);
		}

		this._onDidChangeViewZones.fire({ uri, added, removed: [] });
		return ids;
	}

	removeViewZones(uri: string, ids: string[]): void {
		const uriZones = this._zones.get(uri);
		if (uriZones) {
			const removed: string[] = [];
			for (const id of ids) {
				const index = uriZones.findIndex(z => z.id === id);
				if (index !== -1) {
					uriZones.splice(index, 1);
					removed.push(id);
				}
			}
			if (removed.length > 0) {
				this._onDidChangeViewZones.fire({ uri, added: [], removed });
			}
		}
	}

	async getViewZones(uri: string): Promise<IServerViewZone[]> {
		return this._zones.get(uri) || [];
	}
}

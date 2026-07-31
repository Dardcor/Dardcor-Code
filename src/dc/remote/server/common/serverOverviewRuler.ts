import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerOverviewRulerZone {
	readonly startLineNumber: number;
	readonly endLineNumber: number;
	readonly color: string;
	readonly position: 'Left' | 'Center' | 'Right' | 'Full';
}

export interface IServerOverviewRulerService {
	readonly onDidChangeZones: Event<{ uri: string; zones: IServerOverviewRulerZone[] }>;
	getZones(uri: string): Promise<IServerOverviewRulerZone[]>;
	setZones(uri: string, zones: IServerOverviewRulerZone[]): void;
}

export class ServerOverviewRulerCommon implements IServerOverviewRulerService {
	private readonly _zones = new Map<string, IServerOverviewRulerZone[]>();

	private readonly _onDidChangeZones = new Emitter<{ uri: string; zones: IServerOverviewRulerZone[] }>();
	readonly onDidChangeZones = this._onDidChangeZones.event;

	async getZones(uri: string): Promise<IServerOverviewRulerZone[]> {
		return this._zones.get(uri) || [];
	}

	setZones(uri: string, zones: IServerOverviewRulerZone[]): void {
		this._zones.set(uri, zones);
		this._onDidChangeZones.fire({ uri, zones });
	}
}

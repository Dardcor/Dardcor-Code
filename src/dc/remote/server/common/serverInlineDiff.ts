import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerInlineDiff {
	readonly originalLineNumber: number;
	readonly modifiedLineNumber: number;
	readonly originalContent: string;
	readonly modifiedContent: string;
}

export interface IServerInlineDiffService {
	readonly onDidChangeInlineDiffs: Event<{ uri: string; diffs: IServerInlineDiff[] }>;
	getInlineDiffs(uri: string): Promise<IServerInlineDiff[]>;
	setInlineDiffs(uri: string, diffs: IServerInlineDiff[]): void;
}

export class ServerInlineDiffCommon implements IServerInlineDiffService {
	private readonly _diffs = new Map<string, IServerInlineDiff[]>();

	private readonly _onDidChangeInlineDiffs = new Emitter<{ uri: string; diffs: IServerInlineDiff[] }>();
	readonly onDidChangeInlineDiffs = this._onDidChangeInlineDiffs.event;

	async getInlineDiffs(uri: string): Promise<IServerInlineDiff[]> {
		return this._diffs.get(uri) || [];
	}

	setInlineDiffs(uri: string, diffs: IServerInlineDiff[]): void {
		this._diffs.set(uri, diffs);
		this._onDidChangeInlineDiffs.fire({ uri, diffs });
	}
}

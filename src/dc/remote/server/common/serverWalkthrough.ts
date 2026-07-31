import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerWalkthroughStep {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly command?: string;
	readonly media?: string;
}

export interface IServerWalkthrough {
	readonly id: string;
	readonly title: string;
	readonly steps: IServerWalkthroughStep[];
}

export interface IServerWalkthroughService {
	readonly onDidChangeWalkthroughs: Event<void>;
	readonly onDidStartWalkthrough: Event<string>;
	readonly onDidCompleteWalkthrough: Event<string>;
	registerWalkthrough(walkthrough: IServerWalkthrough): IDisposable;
	getWalkthroughs(): IServerWalkthrough[];
	startWalkthrough(id: string): void;
	completeWalkthrough(id: string): void;
}

export class ServerWalkthroughCommon implements IServerWalkthroughService {
	private readonly _walkthroughs = new Map<string, IServerWalkthrough>();

	private readonly _onDidChangeWalkthroughs = new Emitter<void>();
	readonly onDidChangeWalkthroughs = this._onDidChangeWalkthroughs.event;

	private readonly _onDidStartWalkthrough = new Emitter<string>();
	readonly onDidStartWalkthrough = this._onDidStartWalkthrough.event;

	private readonly _onDidCompleteWalkthrough = new Emitter<string>();
	readonly onDidCompleteWalkthrough = this._onDidCompleteWalkthrough.event;

	registerWalkthrough(walkthrough: IServerWalkthrough): IDisposable {
		this._walkthroughs.set(walkthrough.id, walkthrough);
		this._onDidChangeWalkthroughs.fire();
		return {
			dispose: () => {
				this._walkthroughs.delete(walkthrough.id);
				this._onDidChangeWalkthroughs.fire();
			}
		};
	}

	getWalkthroughs(): IServerWalkthrough[] {
		return Array.from(this._walkthroughs.values());
	}

	startWalkthrough(id: string): void {
		if (this._walkthroughs.has(id)) {
			this._onDidStartWalkthrough.fire(id);
		}
	}

	completeWalkthrough(id: string): void {
		if (this._walkthroughs.has(id)) {
			this._onDidCompleteWalkthrough.fire(id);
		}
	}
}

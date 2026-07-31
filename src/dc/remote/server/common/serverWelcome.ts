import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerWelcomePage {
	readonly id: string;
	readonly title: string;
	readonly showOnStartup: boolean;
	readonly content: string;
}

export interface IServerWelcomeService {
	readonly onDidChangeWelcomePage: Event<IServerWelcomePage>;
	showWelcomePage(id: string): void;
	registerWelcomePage(page: IServerWelcomePage): IDisposable;
	getWelcomePages(): IServerWelcomePage[];
}

export class ServerWelcomeCommon implements IServerWelcomeService {
	private readonly _pages = new Map<string, IServerWelcomePage>();

	private readonly _onDidChangeWelcomePage = new Emitter<IServerWelcomePage>();
	readonly onDidChangeWelcomePage = this._onDidChangeWelcomePage.event;

	showWelcomePage(id: string): void {
		const page = this._pages.get(id);
		if (page) {
			this._onDidChangeWelcomePage.fire(page);
		}
	}

	registerWelcomePage(page: IServerWelcomePage): IDisposable {
		this._pages.set(page.id, page);
		return { dispose: () => { this._pages.delete(page.id); } };
	}

	getWelcomePages(): IServerWelcomePage[] {
		return Array.from(this._pages.values());
	}
}

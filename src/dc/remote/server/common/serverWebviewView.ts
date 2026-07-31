import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerWebviewViewDescriptor {
	readonly id: string;
	readonly name: string;
	readonly viewType: string;
	readonly containerViewType?: string;
}

export interface IServerWebviewViewService {
	readonly onDidRegisterView: Event<IServerWebviewViewDescriptor>;
	readonly onDidUnregisterView: Event<string>;
	registerWebviewView(descriptor: IServerWebviewViewDescriptor): IDisposable;
	getWebviewView(id: string): IServerWebviewViewDescriptor | undefined;
	getAllWebviewViews(): IServerWebviewViewDescriptor[];
}

export class ServerWebviewViewCommon implements IServerWebviewViewService {
	private readonly _views = new Map<string, IServerWebviewViewDescriptor>();

	private readonly _onDidRegisterView = new Emitter<IServerWebviewViewDescriptor>();
	readonly onDidRegisterView: Event<IServerWebviewViewDescriptor> = this._onDidRegisterView.event;

	private readonly _onDidUnregisterView = new Emitter<string>();
	readonly onDidUnregisterView: Event<string> = this._onDidUnregisterView.event;

	registerWebviewView(descriptor: IServerWebviewViewDescriptor): IDisposable {
		this._views.set(descriptor.id, descriptor);
		this._onDidRegisterView.fire(descriptor);
		return { dispose: () => { this._views.delete(descriptor.id); this._onDidUnregisterView.fire(descriptor.id); } };
	}

	getWebviewView(id: string): IServerWebviewViewDescriptor | undefined {
		return this._views.get(id);
	}

	getAllWebviewViews(): IServerWebviewViewDescriptor[] {
		return Array.from(this._views.values());
	}
}

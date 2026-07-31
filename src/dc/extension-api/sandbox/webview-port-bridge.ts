import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export class WebviewPortBridge extends Disposable {
	private readonly _onDidReceiveMessage = this._register(new Emitter<unknown>());
	readonly onDidReceiveMessage: Event<unknown> = this._onDidReceiveMessage.event;

	private _port: MessagePort | undefined;

	public connect(webviewFrame: HTMLIFrameElement): void {
		this._port?.close();
		const channel = new MessageChannel();
		this._port = channel.port1;
		this._port.onmessage = (event: MessageEvent) => {
			this._onDidReceiveMessage.fire(event.data);
		};
		this._port.start();
		webviewFrame.contentWindow?.postMessage({ __dcPortBridge: true }, '*', [channel.port2]);
	}

	public postMessage(data: unknown): void {
		this._port?.postMessage(data);
	}

	public override dispose(): void {
		this._port?.close();
		this._port = undefined;
		super.dispose();
	}
}

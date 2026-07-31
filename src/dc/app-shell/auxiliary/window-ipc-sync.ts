/**
 * Dardcor Code - Window State Synchronizer Across Secondary Screens
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { AuxiliaryWindowService } from './auxiliary-window-service';
import { AuxiliaryWindowElement } from './auxiliary-window-element';

export const enum WindowSyncTopic {
	THEME = 'theme',
	LAYOUT = 'layout',
	EDITOR = 'editor',
	NOTIFICATION = 'notification',
	FOCUS = 'focus',
	STATE = 'state',
}

export interface IWindowSyncMessage {
	readonly topic: WindowSyncTopic;
	readonly sourceWindowId: string;
	readonly payload: unknown;
	readonly timestamp: number;
}

export interface IWindowSyncOptions {
	readonly channelName?: string;
	readonly windowId?: string;
}

const DEFAULT_CHANNEL = 'dc:window-sync';

export class WindowIpcSync extends Disposable {
	private readonly _channelName: string;
	private readonly _windowId: string;
	private readonly _auxiliaryService: AuxiliaryWindowService | null;
	private _channel: BroadcastChannel | null = null;
	private _activeListeners = 0;

	private readonly _onDidReceive = this._register(new Emitter<IWindowSyncMessage>());
	readonly onDidReceive: Event<IWindowSyncMessage> = this._onDidReceive.event;

	private readonly _onDidBroadcast = this._register(new Emitter<IWindowSyncMessage>());
	readonly onDidBroadcast: Event<IWindowSyncMessage> = this._onDidBroadcast.event;

	constructor(options: IWindowSyncOptions = {}, auxiliaryService: AuxiliaryWindowService | null = null) {
		super();
		this._channelName = options.channelName ?? DEFAULT_CHANNEL;
		this._windowId = options.windowId ?? `window-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		this._auxiliaryService = auxiliaryService;

		if (typeof BroadcastChannel !== 'undefined') {
			this._channel = new BroadcastChannel(this._channelName);
			this._channel.addEventListener('message', (event: MessageEvent) => this._onMessage(event.data));
		} else {
			this._registerWindowMessaging();
		}

		if (this._auxiliaryService) {
			this._register(this._auxiliaryService.onDidOpen(win => this._syncWindow(win)));
		}
	}

	get windowId(): string {
		return this._windowId;
	}

	get isSupported(): boolean {
		return this._channel !== null;
	}

	send(topic: WindowSyncTopic, payload: unknown): void {
		const message: IWindowSyncMessage = {
			topic,
			sourceWindowId: this._windowId,
			payload,
			timestamp: Date.now(),
		};
		if (this._channel) {
			try {
				this._channel.postMessage(message);
			} catch {
				// channel unavailable
			}
		}
		for (const win of this._auxiliaryService?.getWindows() ?? []) {
			win.postMessage({ __dcSync: message });
		}
		this._onDidBroadcast.fire(message);
	}

	sendToWindow(windowId: string, topic: WindowSyncTopic, payload: unknown): void {
		if (!this._auxiliaryService) {
			return;
		}
		const win = this._auxiliaryService.getWindow(windowId);
		if (!win) {
			return;
		}
		const message: IWindowSyncMessage = {
			topic,
			sourceWindowId: this._windowId,
			payload,
			timestamp: Date.now(),
		};
		win.postMessage({ __dcSync: message });
		this._onDidBroadcast.fire(message);
	}

	syncTheme(theme: { readonly themeId: string; readonly colors: Record<string, string> }): void {
		this.send(WindowSyncTopic.THEME, theme);
	}

	syncLayout(state: { readonly sidebarVisible: boolean; readonly panelVisible: boolean; readonly zenMode: boolean }): void {
		this.send(WindowSyncTopic.LAYOUT, state);
	}

	syncActiveEditor(editor: { readonly uri: string; readonly name: string } | null): void {
		this.send(WindowSyncTopic.EDITOR, editor);
	}

	syncNotification(notification: { readonly message: string; readonly severity: number; readonly source?: string }): void {
		this.send(WindowSyncTopic.NOTIFICATION, notification);
	}

	announceFocus(): void {
		this.send(WindowSyncTopic.FOCUS, { focused: true });
	}

	requestState(): void {
		this.send(WindowSyncTopic.STATE, { request: true });
	}

	private _onMessage(message: unknown): void {
		const sync = message as IWindowSyncMessage | undefined;
		if (!sync || !sync.topic || sync.sourceWindowId === this._windowId) {
			return;
		}
		if (sync.topic === WindowSyncTopic.STATE && (sync.payload as { request?: boolean } | undefined)?.request) {
			this.announceFocus();
			return;
		}
		this._onDidReceive.fire(sync);
	}

	private _syncWindow(win: AuxiliaryWindowElement): void {
		this.sendToWindow(win.id, WindowSyncTopic.STATE, { joined: true, windowId: this._windowId });
	}

	private _registerWindowMessaging(): void {
		const onMessage = (event: MessageEvent) => {
			const data = event.data as { __dcSync?: IWindowSyncMessage } | undefined;
			if (data?.__dcSync) {
				this._onMessage(data.__dcSync);
			}
		};
		window.addEventListener('message', onMessage);
		this._register({ dispose: () => window.removeEventListener('message', onMessage) });
	}

	dispose(): void {
		this._channel?.close();
		this._channel = null;
		super.dispose();
	}
}

/**
 * Dardcor Code - Output Channel Panel Viewer Component
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../core/dom/element';
import { OutputChannel, IOutputChannelRegistry, OutputChannelRegistry } from './output-channel-registry';

export class OutputView extends Disposable {
	private readonly _onDidSelectChannel = this._register(new Emitter<string>());
	readonly onDidSelectChannel: Event<string> = this._onDidSelectChannel.event;

	private readonly _container: HTMLElement;
	private readonly _channelSelect: HTMLSelectElement;
	private readonly _content: HTMLElement;
	private readonly _clearButton: HTMLButtonElement;
	private readonly _autoScrollCheckbox: HTMLInputElement;
	private readonly _registry: IOutputChannelRegistry;
	private _activeChannel: OutputChannel | undefined;
	private _renderQueued = false;

	constructor(parentDom: HTMLElement, registry?: IOutputChannelRegistry) {
		super();
		this._registry = registry ?? OutputChannelRegistry;

		this._container = $<HTMLElement>('div', 'dc-output-view');
		this._container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:#1e1e1e;';

		const toolbar = $<HTMLElement>('div');
		toolbar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 12px;border-bottom:1px solid #2a2d2e;';

		this._channelSelect = $<HTMLSelectElement>('select', 'dc-output-channel-select');
		this._channelSelect.style.cssText = 'background:#3c3c3c;border:1px solid #3c3c3c;border-radius:2px;color:#cccccc;font-size:12px;padding:2px 6px;outline:none;';

		this._clearButton = $<HTMLButtonElement>('button');
		this._clearButton.textContent = 'Bersihkan';
		this._clearButton.style.cssText = 'background:transparent;border:none;color:#cccccc;font-size:12px;cursor:pointer;padding:2px 8px;';
		this._clearButton.addEventListener('mouseenter', () => {
			this._clearButton.style.background = '#2a2d2e';
		});
		this._clearButton.addEventListener('mouseleave', () => {
			this._clearButton.style.background = 'transparent';
		});

		this._autoScrollCheckbox = $<HTMLInputElement>('input');
		this._autoScrollCheckbox.type = 'checkbox';
		this._autoScrollCheckbox.checked = true;
		const autoScrollLabel = $<HTMLLabelElement>('label');
		autoScrollLabel.style.cssText = 'display:flex;align-items:center;gap:4px;color:#8a8a8a;font-size:12px;cursor:pointer;user-select:none;';
		autoScrollLabel.appendChild(this._autoScrollCheckbox);
		autoScrollLabel.appendChild(document.createTextNode('Auto Scroll'));

		const spacer = $<HTMLElement>('div');
		spacer.style.cssText = 'flex:1;';

		toolbar.appendChild(this._channelSelect);
		toolbar.appendChild(spacer);
		toolbar.appendChild(autoScrollLabel);
		toolbar.appendChild(this._clearButton);
		this._container.appendChild(toolbar);

		this._content = $<HTMLElement>('div', 'dc-output-content');
		this._content.style.cssText = 'flex:1;overflow-y:auto;padding:6px 12px;';
		this._content.tabIndex = 0;
		this._content.style.outline = 'none';
		this._container.appendChild(this._content);
		parentDom.appendChild(this._container);

		this._register(addDisposableListener(this._channelSelect, 'change', () => {
			this._selectChannel(this._channelSelect.value);
		}));
		this._register(addDisposableListener(this._clearButton, 'click', () => {
			this._activeChannel?.clear();
			clearNode(this._content);
		}));
		this._register(addDisposableListener(this._content, 'keydown', (e) => {
			const kd = e as KeyboardEvent;
			if (kd.key === 'l' && (kd.ctrlKey || kd.metaKey)) {
				e.preventDefault();
				this._activeChannel?.clear();
				clearNode(this._content);
			}
		}));
		this._register(this._registry.onDidAddChannel(() => this._refreshChannelList()));
		this._register(this._registry.onDidRemoveChannel(() => this._refreshChannelList()));

		this._refreshChannelList();
	}

	public get activeChannelId(): string | undefined {
		return this._activeChannel?.id;
	}

	public showChannel(id: string): void {
		this._selectChannel(id);
	}

	private _refreshChannelList(): void {
		const previous = this._channelSelect.value;
		clearNode(this._channelSelect);
		const channels = this._registry.channels;
		if (channels.length === 0 && !this._activeChannel) {
			const placeholder = document.createElement('option');
			placeholder.value = '';
			placeholder.textContent = '(tidak ada channel)';
			this._channelSelect.appendChild(placeholder);
			this._channelSelect.disabled = true;
			return;
		}
		this._channelSelect.disabled = false;
		for (const channel of channels) {
			const option = document.createElement('option');
			option.value = channel.id;
			option.textContent = channel.id;
			this._channelSelect.appendChild(option);
		}
		const target = previous && this._registry.getChannel(previous) ? previous : channels[channels.length - 1]?.id;
		if (target) {
			this._channelSelect.value = target;
			this._selectChannel(target);
		}
	}

	private _selectChannel(id: string): void {
		const channel = this._registry.getChannel(id);
		if (!channel) {
			return;
		}
		if (this._activeChannel) {
			this._unsubscribe(this._activeChannel);
		}
		this._activeChannel = channel;
		this._subscribe(channel);
		clearNode(this._content);
		this._appendText(channel.getText());
		this._onDidSelectChannel.fire(id);
	}

	private _disposableByChannel = new Map<OutputChannel, { dispose(): void }>();

	private _subscribe(channel: OutputChannel): void {
		const disposable = channel.onDidChange(() => this._scheduleRender(channel));
		this._disposableByChannel.set(channel, disposable);
	}

	private _unsubscribe(channel: OutputChannel): void {
		const disposable = this._disposableByChannel.get(channel);
		disposable?.dispose();
		this._disposableByChannel.delete(channel);
	}

	private _scheduleRender(channel: OutputChannel): void {
		if (channel !== this._activeChannel || this._renderQueued) {
			return;
		}
		this._renderQueued = true;
		requestAnimationFrame(() => {
			this._renderQueued = false;
			if (channel === this._activeChannel) {
				this._appendText(channel.getText());
			}
		});
	}

	private _appendText(text: string): void {
		clearNode(this._content);
		const pre = document.createElement('pre');
		pre.style.cssText = 'margin:0;font-family:Consolas,monospace;font-size:12px;color:#cccccc;white-space:pre-wrap;word-break:break-all;';
		pre.textContent = text;
		this._content.appendChild(pre);
		if (this._autoScrollCheckbox.checked) {
			this._content.scrollTop = this._content.scrollHeight;
		}
	}

	public clearActive(): void {
		this._activeChannel?.clear();
		clearNode(this._content);
	}
}

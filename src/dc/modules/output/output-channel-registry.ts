/**
 * Dardcor Code - Named Output Stream Log Registration Table
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { createDecorator } from '../../services/instantiation/annotations.js';

export class OutputChannel extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private _lines: string[] = [];
	private _totalLength = 0;

	constructor(readonly id: string) {
		super();
	}

	get isDisposed(): boolean {
		return this._store.isDisposed;
	}

	get lineCount(): number {
		return this._lines.length;
	}

	public append(text: string): void {
		if (!text) {
			return;
		}
		const parts = text.split(/\r\n|\r|\n/);
		if (this._lines.length === 0) {
			this._lines.push(parts.shift() ?? '');
		}
		this._lines[this._lines.length - 1] += parts.shift() ?? '';
		for (const part of parts) {
			this._lines.push(part);
		}
		this._totalLength += text.length;
		if (this._lines.length > 10000) {
			const removed = this._lines.splice(0, this._lines.length - 10000);
			this._totalLength = Math.max(0, this._totalLength - removed.join('\n').length);
		}
		this._onDidChange.fire();
	}

	public appendLine(text: string): void {
		this.append(text + '\n');
	}

	public clear(): void {
		this._lines = [];
		this._totalLength = 0;
		this._onDidChange.fire();
	}

	public getText(): string {
		return this._lines.join('\n');
	}

	public getLines(start = 0, end = Number.MAX_SAFE_INTEGER): string[] {
		return this._lines.slice(start, end);
	}

	public get length(): number {
		return this._totalLength;
	}
}

export interface IOutputChannelRegistry {
	readonly _serviceBrand: undefined;
	readonly onDidAddChannel: Event<OutputChannel>;
	readonly onDidRemoveChannel: Event<string>;
	readonly channels: readonly OutputChannel[];
	getChannel(id: string): OutputChannel | undefined;
	createChannel(id: string): OutputChannel;
	removeChannel(id: string): void;
}

export const IOutputChannelRegistry = createDecorator<IOutputChannelRegistry>('outputChannelRegistry');

export class OutputChannelRegistryImpl extends Disposable implements IOutputChannelRegistry {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidAddChannel = this._register(new Emitter<OutputChannel>());
	readonly onDidAddChannel: Event<OutputChannel> = this._onDidAddChannel.event;

	private readonly _onDidRemoveChannel = this._register(new Emitter<string>());
	readonly onDidRemoveChannel: Event<string> = this._onDidRemoveChannel.event;

	private readonly _channels = new Map<string, OutputChannel>();

	get channels(): readonly OutputChannel[] {
		return [...this._channels.values()];
	}

	public getChannel(id: string): OutputChannel | undefined {
		return this._channels.get(id);
	}

	public createChannel(id: string): OutputChannel {
		let channel = this._channels.get(id);
		if (!channel) {
			channel = new OutputChannel(id);
			this._register(channel);
			this._channels.set(id, channel);
			this._onDidAddChannel.fire(channel);
		}
		return channel;
	}

	public removeChannel(id: string): void {
		const channel = this._channels.get(id);
		if (channel) {
			this._channels.delete(id);
			channel.dispose();
			this._onDidRemoveChannel.fire(id);
		}
	}

	public clearAll(): void {
		for (const channel of this._channels.values()) {
			channel.clear();
		}
	}
}

export const OutputChannelRegistry: IOutputChannelRegistry = new OutputChannelRegistryImpl();

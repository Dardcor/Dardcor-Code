import { Disposable, IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface IOutputSink {
	append(channelId: string, text: string): void;
	clear(channelId: string): void;
	show(channelId: string, preserveFocus?: boolean): void;
	dispose?(channelId: string): void;
}

let outputSink: IOutputSink | undefined;

export function setOutputSink(sink: IOutputSink | undefined): void {
	outputSink = sink;
}

export function getOutputSink(): IOutputSink | undefined {
	return outputSink;
}

export interface IOutputChannel extends IDisposable {
	readonly name: string;
	append(value: string): void;
	appendLine(value: string): void;
	clear(): void;
	show(preserveFocus?: boolean): void;
	hide(): void;
	dispose(): void;
}

export class OutputChannelImpl implements IOutputChannel {
	private readonly _lines: string[] = [];
	private _visible = false;
	private _disposed = false;

	private readonly _onDidAppend = new Emitter<string>();
	readonly onDidAppend: Event<string> = this._onDidAppend.event;

	constructor(
		public readonly id: string,
		public readonly name: string
	) {}

	public append(value: string): void {
		if (this._disposed) {
			return;
		}
		this._lines.push(value);
		outputSink?.append(this.id, value);
		this._onDidAppend.fire(value);
	}

	public appendLine(value: string): void {
		this.append(`${value}\n`);
	}

	public clear(): void {
		this._lines.length = 0;
		outputSink?.clear(this.id);
	}

	public show(preserveFocus = false): void {
		if (this._disposed) {
			return;
		}
		this._visible = true;
		outputSink?.show(this.id, preserveFocus);
	}

	public hide(): void {
		this._visible = false;
	}

	public get isVisible(): boolean {
		return this._visible;
	}

	public getContent(): string {
		return this._lines.join('');
	}

	public getLineCount(): number {
		return this._lines.length;
	}

	public dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		outputSink?.dispose?.(this.id);
		this._onDidAppend.dispose();
	}
}

export class ExtHostOutputChannels extends Disposable {
	private readonly _channels = new Map<string, OutputChannelImpl>();
	private _nextId = 1;

	private readonly _onDidCreateChannel = this._register(new Emitter<OutputChannelImpl>());
	readonly onDidCreateChannel: Event<OutputChannelImpl> = this._onDidCreateChannel.event;

	public createOutputChannel(name: string): IOutputChannel {
		const channel = new OutputChannelImpl(`channel-${this._nextId++}`, name);
		this._channels.set(channel.id, channel);
		this._onDidCreateChannel.fire(channel);
		return channel;
	}

	public getChannel(id: string): OutputChannelImpl | undefined {
		return this._channels.get(id);
	}

	public getChannels(): OutputChannelImpl[] {
		return [...this._channels.values()];
	}

	public override dispose(): void {
		for (const channel of this._channels.values()) {
			channel.dispose();
		}
		this._channels.clear();
		super.dispose();
	}
}

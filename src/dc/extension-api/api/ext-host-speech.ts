import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface ISpeechRecognizerOptions {
	language?: string;
}

export interface ISpeechRecognizer {
	readonly providerId: string;
	start(): void;
	stop(): string;
	readonly onDidRecognize: Event<string>;
	simulateSpeech(text: string): void;
	dispose(): void;
}

export interface ISpeechProvider {
	createSpeechRecognizer?(options?: ISpeechRecognizerOptions): ISpeechRecognizer;
}

export class SimulatedSpeechRecognizer extends Disposable implements ISpeechRecognizer {
	private readonly _spoken: string[] = [];
	private _running = false;

	private readonly _onDidRecognize = this._register(new Emitter<string>());
	readonly onDidRecognize: Event<string> = this._onDidRecognize.event;

	constructor(
		public readonly providerId: string,
		private readonly _options: ISpeechRecognizerOptions = {}
	) {
		super();
	}

	public start(): void {
		this._spoken.length = 0;
		this._running = true;
	}

	public isRunning(): boolean {
		return this._running;
	}

	public simulateSpeech(text: string): void {
		if (!this._running) {
			return;
		}
		this._spoken.push(text);
		this._onDidRecognize.fire(text);
	}

	public stop(): string {
		this._running = false;
		return this._spoken.join(' ');
	}

	public get language(): string | undefined {
		return this._options.language;
	}

	public override dispose(): void {
		this._spoken.length = 0;
		this._running = false;
		super.dispose();
	}
}

export class ExtHostSpeech extends Disposable {
	private readonly _providers = new Map<string, ISpeechProvider>();
	private _active: { providerId: string; recognizer: ISpeechRecognizer } | undefined;

	public registerSpeechProvider(id: string, provider: ISpeechProvider): IDisposable {
		if (this._providers.has(id)) {
			throw new Error(`Speech provider '${id}' sudah terdaftar`);
		}
		this._providers.set(id, provider);
		return toDisposable(() => {
			this._providers.delete(id);
			if (this._active?.providerId === id) {
				this._active.recognizer.dispose();
				this._active = undefined;
			}
		});
	}

	public startRecognition(providerId?: string, options: ISpeechRecognizerOptions = {}): void {
		const id = providerId ?? [...this._providers.keys()][0];
		if (id === undefined) {
			throw new Error('Tidak ada speech provider yang terdaftar');
		}
		const provider = this._providers.get(id);
		if (!provider) {
			throw new Error(`Speech provider '${id}' tidak terdaftar`);
		}
		const recognizer = provider.createSpeechRecognizer?.(options) ?? new SimulatedSpeechRecognizer(id, options);
		recognizer.start();
		this._active = { providerId: id, recognizer };
	}

	public stopRecognition(): string {
		if (!this._active) {
			return '';
		}
		const result = this._active.recognizer.stop();
		this._active = undefined;
		return result;
	}

	public getActiveProviderId(): string | undefined {
		return this._active?.providerId;
	}

	public isRecognizing(): boolean {
		return this._active !== undefined;
	}

	public getProviderIds(): string[] {
		return [...this._providers.keys()];
	}

	public getProviderCount(): number {
		return this._providers.size;
	}

	public override dispose(): void {
		this._active?.recognizer.dispose();
		this._active = undefined;
		this._providers.clear();
		super.dispose();
	}
}

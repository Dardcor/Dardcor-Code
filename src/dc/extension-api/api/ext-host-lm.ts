import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';

export interface IChatModel {
	readonly id: string;
	readonly name: string;
	readonly maxInputTokens: number;
	readonly maxOutputTokens: number;
	vendor?: string;
	family?: string;
	version?: string;
}

export interface IChatModelSelector {
	id?: string;
	vendor?: string;
	family?: string;
	version?: string;
}

export interface IChatMessage {
	readonly role: 'user' | 'assistant' | 'system';
	readonly content: string;
}

export interface IChatRequestOptions {
	maxTokens?: number;
	temperature?: number;
	stop?: string[];
}

export interface IChatModelRegistration {
	readonly model: IChatModel;
	readonly dispose: () => void;
}

export class ExtHostLM extends Disposable {
	private readonly _models: IChatModel[] = [];
	private _nextModelId = 1;

	constructor() {
		super();
		this._models.push({
			id: 'dardcor-default',
			name: 'Dardcor Default',
			maxInputTokens: 8192,
			maxOutputTokens: 2048,
			vendor: 'dardcor',
			family: 'default'
		});
	}

	public async selectChatModels(selector?: IChatModelSelector): Promise<IChatModel[]> {
		await Promise.resolve();
		if (!selector) {
			return this._models.map(model => ({ ...model }));
		}
		return this._models
			.filter(model => this._matches(model, selector))
			.map(model => ({ ...model }));
	}

	public async *sendChatRequest(model: IChatModel, messages: IChatMessage[], options: IChatRequestOptions = {}): AsyncIterable<string> {
		const prompt = messages.map(message => `${message.role}: ${message.content}`).join('\n');
		const tokens = this.countTokens(prompt);
		const maxOutput = options.maxTokens ?? model.maxOutputTokens;
		const response = this._generateResponse(model, tokens);
		const words = response.split(/\s+/).filter(word => word.length > 0);
		let emitted = 0;
		for (const word of words) {
			if (emitted >= maxOutput) {
				break;
			}
			await this._delay(this._chunkDelayMs());
			yield `${word} `;
			emitted++;
		}
	}

	public countTokens(text: string): number {
		const trimmed = text.trim();
		if (trimmed.length === 0) {
			return 0;
		}
		return trimmed.split(/\s+/).length;
	}

	public registerChatModel(model: IChatModel): IChatModelRegistration {
		const id = `model-${this._nextModelId++}`;
		const registered: IChatModel = { ...model, id: model.id ?? id };
		this._models.push(registered);
		return {
			model: { ...registered },
			dispose: () => {
				const index = this._models.indexOf(registered);
				if (index !== -1) {
					this._models.splice(index, 1);
				}
			}
		};
	}

	public getModels(): IChatModel[] {
		return this._models.map(model => ({ ...model }));
	}

	public getModel(id: string): IChatModel | undefined {
		const model = this._models.find(candidate => candidate.id === id);
		return model ? { ...model } : undefined;
	}

	public override dispose(): void {
		this._models.length = 0;
		super.dispose();
	}

	private _matches(model: IChatModel, selector: IChatModelSelector): boolean {
		if (selector.id !== undefined && model.id !== selector.id) {
			return false;
		}
		if (selector.vendor !== undefined && model.vendor !== selector.vendor) {
			return false;
		}
		if (selector.family !== undefined && model.family !== selector.family) {
			return false;
		}
		if (selector.version !== undefined && model.version !== selector.version) {
			return false;
		}
		return true;
	}

	private _generateResponse(model: IChatModel, inputTokens: number): string {
		return [
			`[${model.name}]`,
			`menerima ${inputTokens} token input.`,
			'Permintaan diproses melalui pipeline inference in-memory.',
			'Hasil dihasilkan secara deterministik dari konteks pesan.',
			'Gunakan sendChatRequest untuk streaming respons token demi token.',
			'Selesai.'
		].join(' ');
	}

	private _chunkDelayMs(): number {
		return 15 + Math.floor(Math.random() * 20);
	}

	private _delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}

export function countTokens(text: string): number {
	return new ExtHostLM().countTokens(text);
}

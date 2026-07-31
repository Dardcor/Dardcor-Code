import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerColor {
	readonly red: number;
	readonly green: number;
	readonly blue: number;
	readonly alpha: number;
}

export interface IServerColorInformation {
	readonly range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
	readonly color: IServerColor;
}

export interface IServerColorPresentation {
	readonly label: string;
	readonly textEdit?: { range: any; text: string };
	readonly additionalTextEdits?: { range: any; text: string }[];
}

export interface IServerColorProvider {
	readonly id: string;
	provideDocumentColors(uri: string): Promise<IServerColorInformation[]>;
	provideColorPresentations(uri: string, colorInfo: IServerColorInformation): Promise<IServerColorPresentation[]>;
}

export interface IServerColorPickerService {
	readonly onDidRegisterProvider: Event<IServerColorProvider>;
	registerColorProvider(provider: IServerColorProvider): IDisposable;
	provideDocumentColors(uri: string): Promise<IServerColorInformation[]>;
	provideColorPresentations(uri: string, colorInfo: IServerColorInformation): Promise<IServerColorPresentation[]>;
}

export class ServerColorPickerCommon implements IServerColorPickerService {
	private readonly _providers = new Map<string, IServerColorProvider>();

	private readonly _onDidRegisterProvider = new Emitter<IServerColorProvider>();
	readonly onDidRegisterProvider = this._onDidRegisterProvider.event;

	registerColorProvider(provider: IServerColorProvider): IDisposable {
		this._providers.set(provider.id, provider);
		this._onDidRegisterProvider.fire(provider);
		return { dispose: () => { this._providers.delete(provider.id); } };
	}

	async provideDocumentColors(uri: string): Promise<IServerColorInformation[]> {
		const colors: IServerColorInformation[] = [];
		for (const provider of this._providers.values()) {
			const result = await provider.provideDocumentColors(uri);
			if (result) {
				colors.push(...result);
			}
		}
		return colors;
	}

	async provideColorPresentations(uri: string, colorInfo: IServerColorInformation): Promise<IServerColorPresentation[]> {
		const presentations: IServerColorPresentation[] = [];
		for (const provider of this._providers.values()) {
			const result = await provider.provideColorPresentations(uri, colorInfo);
			if (result) {
				presentations.push(...result);
			}
		}
		return presentations;
	}
}

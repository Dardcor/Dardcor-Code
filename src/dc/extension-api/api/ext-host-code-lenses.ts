import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { DocumentSelector, matchesSelector } from './ext-host-languages.js';
import { TextDocument } from './ext-host-documents.js';
import { Range } from './ext-host-api-impl.js';
import { CancellationToken } from '../../core/async/cancellation.js';

export interface ICodeLensCommand {
	title: string;
	command: string;
	arguments?: any[];
}

export interface ICodeLens {
	range: Range;
	command?: ICodeLensCommand;
	isResolved?: boolean;
}

export interface ICodeLensProvider {
	provideCodeLenses(document: TextDocument, token: CancellationToken): ICodeLens[] | Promise<ICodeLens[]> | undefined;
	resolveCodeLens?(codeLens: ICodeLens, token: CancellationToken): ICodeLens | Promise<ICodeLens> | undefined;
}

interface ICodeLensProviderRegistration {
	readonly selector: DocumentSelector;
	readonly provider: ICodeLensProvider;
}

export class ExtHostCodeLenses extends Disposable {
	private readonly _providers: ICodeLensProviderRegistration[] = [];

	private readonly _onDidChangeCodeLenses = this._register(new Emitter<void>());
	readonly onDidChangeCodeLenses: Event<void> = this._onDidChangeCodeLenses.event;

	public registerCodeLensProvider(selector: DocumentSelector, provider: ICodeLensProvider): IDisposable {
		const registration: ICodeLensProviderRegistration = { selector, provider };
		this._providers.push(registration);
		this._onDidChangeCodeLenses.fire();
		return toDisposable(() => {
			const index = this._providers.indexOf(registration);
			if (index !== -1) {
				this._providers.splice(index, 1);
				this._onDidChangeCodeLenses.fire();
			}
		});
	}

	public async provideCodeLenses(document: TextDocument, token: CancellationToken = CancellationToken.None): Promise<ICodeLens[]> {
		const lenses: ICodeLens[] = [];
		for (const registration of this._providers) {
			if (token.isCancellationRequested) {
				break;
			}
			if (!matchesSelector(registration.selector, document.uri, document.languageId)) {
				continue;
			}
			const provided = await registration.provider.provideCodeLenses(document, token);
			if (provided) {
				lenses.push(...provided);
			}
		}
		return lenses;
	}

	public async resolveCodeLens(codeLens: ICodeLens, document: TextDocument, token: CancellationToken = CancellationToken.None): Promise<ICodeLens> {
		if (codeLens.isResolved) {
			return codeLens;
		}
		for (const registration of this._providers) {
			if (token.isCancellationRequested) {
				break;
			}
			if (!matchesSelector(registration.selector, document.uri, document.languageId)) {
				continue;
			}
			if (!registration.provider.resolveCodeLens) {
				continue;
			}
			const resolved = await registration.provider.resolveCodeLens(codeLens, token);
			if (resolved) {
				resolved.isResolved = true;
				return resolved;
			}
		}
		return codeLens;
	}

	public getProviderCount(): number {
		return this._providers.length;
	}

	public override dispose(): void {
		this._providers.length = 0;
		super.dispose();
	}
}

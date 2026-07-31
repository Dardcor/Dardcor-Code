import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { DocumentSelector, matchesSelector } from './ext-host-languages.js';
import { TextDocument } from './ext-host-documents.js';
import { Range, Position } from './ext-host-api-impl.js';
import { CancellationToken } from '../../core/async/cancellation.js';

export enum InlayHintKind {
	Type = 0,
	Parameter = 1
}

export interface IInlayHint {
	position: Position;
	label: string;
	kind?: InlayHintKind;
	paddingLeft?: boolean;
	paddingRight?: boolean;
	tooltip?: string;
}

export interface IInlayHintsProvider {
	provideInlayHints(document: TextDocument, range: Range, token: CancellationToken): IInlayHint[] | Promise<IInlayHint[]> | undefined;
}

interface IInlayHintsProviderRegistration {
	readonly selector: DocumentSelector;
	readonly provider: IInlayHintsProvider;
}

export class ExtHostInlayHints extends Disposable {
	private readonly _providers: IInlayHintsProviderRegistration[] = [];

	public registerInlayHintsProvider(selector: DocumentSelector, provider: IInlayHintsProvider): IDisposable {
		const registration: IInlayHintsProviderRegistration = { selector, provider };
		this._providers.push(registration);
		return toDisposable(() => {
			const index = this._providers.indexOf(registration);
			if (index !== -1) {
				this._providers.splice(index, 1);
			}
		});
	}

	public async provideInlayHints(document: TextDocument, range: Range, token: CancellationToken = CancellationToken.None): Promise<IInlayHint[]> {
		const hints: IInlayHint[] = [];
		for (const registration of this._providers) {
			if (token.isCancellationRequested) {
				break;
			}
			if (!matchesSelector(registration.selector, document.uri, document.languageId)) {
				continue;
			}
			const provided = await registration.provider.provideInlayHints(document, range, token);
			if (provided) {
				hints.push(...provided);
			}
		}
		hints.sort((a, b) => a.position.compareTo(b.position));
		return hints;
	}

	public async provideInlayHintsForLine(document: TextDocument, line: number, token: CancellationToken = CancellationToken.None): Promise<IInlayHint[]> {
		const start = new Position(line, 0);
		const end = new Position(line, Number.MAX_SAFE_INTEGER);
		const hints = await this.provideInlayHints(document, new Range(start, end), token);
		return hints.filter(hint => hint.position.lineNumber === line);
	}

	public getProviderCount(): number {
		return this._providers.length;
	}

	public override dispose(): void {
		this._providers.length = 0;
		super.dispose();
	}
}

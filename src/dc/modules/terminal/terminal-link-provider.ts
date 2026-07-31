/**
 * Dardcor Code - Clickable Link Detection for Terminal Output
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
export interface ITerminalLink {
	readonly text: string;
	readonly uri: string;
	readonly startLine: number;
	readonly startColumn: number;
	readonly endLine: number;
	readonly endColumn: number;
	readonly tooltip: string;
}

export interface ITerminalLinkProvider {
	readonly id: string;
	provideLinks(line: string, lineNumber: number): ITerminalLink[];
}

export class TerminalLinkProvider extends Disposable {
	private readonly _onDidOpenLink = this._register(new Emitter<ITerminalLink>());
	readonly onDidOpenLink: Event<ITerminalLink> = this._onDidOpenLink.event;

	private readonly _providers: ITerminalLinkProvider[] = [];

	constructor() {
		super();
		this._register(new FilePathLinkProvider());
		this._register(new UrlLinkProvider());
	}

	public registerProvider(provider: ITerminalLinkProvider): void {
		this._providers.push(provider);
	}

	public provideLinks(line: string, lineNumber: number): ITerminalLink[] {
		const links: ITerminalLink[] = [];
		for (const provider of this._providers) {
			links.push(...provider.provideLinks(line, lineNumber));
		}
		return links.sort((a, b) => a.startColumn - b.startColumn);
	}

	public open(link: ITerminalLink): void {
		this._onDidOpenLink.fire(link);
	}

	public static parseFileLinks(line: string, lineNumber: number): ITerminalLink[] {
		const links: ITerminalLink[] = [];
		const patterns: Array<{ re: RegExp; makeUri: (m: RegExpExecArray) => string }> = [
			{
				re: /([A-Za-z]:\\[^\s:()<>"']+\.(?:ts|tsx|js|jsx|json|css|html|py|md|txt)):(\d+)(?::(\d+))?/g,
				makeUri: m => m[1]
			},
			{
				re: /(\/(?:[^\s:()<>"']+\/)+[^\s:()<>"']+\.(?:ts|tsx|js|jsx|json|css|html|py|md|txt)):(\d+)(?::(\d+))?/g,
				makeUri: m => m[1]
			}
		];
		for (const pattern of patterns) {
			const re = new RegExp(pattern.re.source, 'g');
			let match: RegExpExecArray | null;
			while ((match = re.exec(line)) !== null) {
				const file = pattern.makeUri(match);
				const uri = file.startsWith('/') ? `file://${file}` : `file:///${file.replace(/\\/g, '/')}`;
				links.push({
					text: match[0],
					uri,
					startLine: lineNumber,
					startColumn: match.index,
					endLine: lineNumber,
					endColumn: match.index + match[0].length,
					tooltip: `Buka ${file}:${match[2]}`
				});
			}
		}
		return links;
	}

	public static parseUrlLinks(line: string, lineNumber: number): ITerminalLink[] {
		const links: ITerminalLink[] = [];
		const re = /\b(https?:\/\/[^\s<>"'()]+)\b/g;
		let match: RegExpExecArray | null;
		while ((match = re.exec(line)) !== null) {
			links.push({
				text: match[1],
				uri: match[1],
				startLine: lineNumber,
				startColumn: match.index,
				endLine: lineNumber,
				endColumn: match.index + match[1].length,
				tooltip: 'Buka tautan di browser'
			});
		}
		return links;
	}
}

class FilePathLinkProvider extends Disposable implements ITerminalLinkProvider {
	readonly id = 'file-path';
	provideLinks(line: string, lineNumber: number): ITerminalLink[] {
		return TerminalLinkProvider.parseFileLinks(line, lineNumber);
	}
}

class UrlLinkProvider extends Disposable implements ITerminalLinkProvider {
	readonly id = 'url';
	provideLinks(line: string, lineNumber: number): ITerminalLink[] {
		return TerminalLinkProvider.parseUrlLinks(line, lineNumber);
	}
}

/**
 * Dardcor Code - Clickable Output Channel Link Detection & Navigation
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';

export interface IOutputLink {
	readonly startIndex: number;
	readonly endIndex: number;
	readonly text: string;
	readonly resource: string;
	readonly lineNumber: number;
	readonly columnNumber?: number;
}

export class OutputLinkProvider extends Disposable {
	private readonly _onDidOpenLink = this._register(new Emitter<IOutputLink>());
	readonly onDidOpenLink: Event<IOutputLink> = this._onDidOpenLink.event;

	private static readonly _filePatterns: RegExp[] = [
		/([A-Za-z]:\\[^\s()<>"']+\.(?:ts|tsx|js|jsx|json|css|html|py|md|txt|cs|cpp|h|java|go|rs|yml|yaml)):(\d+)(?::(\d+))?/g,
		/(\/[^\s()<>"']+\.(?:ts|tsx|js|jsx|json|css|html|py|md|txt|cs|cpp|h|java|go|rs|yml|yaml)):(\d+)(?::(\d+))?/g
	];

	constructor() {
		super();
	}

	public provideLinks(line: string): IOutputLink[] {
		const links: IOutputLink[] = [];
		for (const re of OutputLinkProvider._filePatterns) {
			let match: RegExpExecArray | null;
			while ((match = re.exec(line)) !== null) {
				const lineNumber = Number(match[2]);
				const columnNumber = match[3] ? Number(match[3]) : undefined;
				links.push({
					startIndex: match.index,
					endIndex: match.index + match[0].length,
					text: match[0],
					resource: match[1],
					lineNumber,
					columnNumber
				});
			}
		}
		return links;
	}

	public open(link: IOutputLink): void {
		this._onDidOpenLink.fire(link);
	}

	public static parseLine(link: IOutputLink): string {
		return link.resource;
	}

	public static lineColumn(link: IOutputLink): string {
		return link.columnNumber !== undefined
			? `${link.lineNumber}:${link.columnNumber}`
			: String(link.lineNumber);
	}

	public static linkAtOffset(text: string, offset: number): IOutputLink | undefined {
		const provider = new OutputLinkProvider();
		const links = provider.provideLinks(text);
		return links.find(link => offset >= link.startIndex && offset <= link.endIndex);
	}

	public static lineStartsWithFile(line: string): boolean {
		return OutputLinkProvider._filePatterns.some(re => {
			const match = new RegExp(re.source).exec(line);
			return match !== null;
		});
	}
}

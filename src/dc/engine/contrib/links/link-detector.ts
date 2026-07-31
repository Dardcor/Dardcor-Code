/**
 * Dardcor Code - Link Pattern Scanner
 */

import { ITextModel, IRange } from "../../model/text-model.js";

export type LinkKind = "url" | "mailto" | "email" | "www";

export interface ILinkDetectorMatch {
	readonly start: number;
	readonly end: number;
	readonly url: string;
	readonly tooltip: string;
	readonly kind: LinkKind;
}

export interface IDetectedLink {
	readonly range: IRange;
	readonly url: string;
	readonly tooltip: string;
}

const URL_RE = /\b(?:https?:\/\/|ftp:\/\/)[^\s"'<>(){}[\]]+(?:[^\s"'<>(){}[\].,;:!?]|$)/g;
const MAIL_RE = /\bmailto:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const WWW_RE = /\bwww\.[A-Za-z0-9.-]+\.[A-Za-z]{2,}[^\s"'<>(){}[\]]*/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

interface _RawMatch {
	readonly start: number;
	readonly end: number;
	readonly text: string;
	readonly kind: LinkKind;
}

export class LinkDetector {
	public static detect(text: string): ILinkDetectorMatch[] {
		const raw: _RawMatch[] = [];
		raw.push(...LinkDetector._findMatches(URL_RE, text).map(m => ({ ...m, kind: "url" as const })));
		raw.push(...LinkDetector._findMatches(MAIL_RE, text).map(m => ({ ...m, kind: "mailto" as const })));
		raw.push(...LinkDetector._findMatches(WWW_RE, text).map(m => ({ ...m, kind: "www" as const })));
		raw.push(...LinkDetector._findMatches(EMAIL_RE, text).map(m => ({ ...m, kind: "email" as const })));

		const sorted = raw.sort((a, b) => a.start - b.start || b.end - a.end);
		const nonOverlapping: _RawMatch[] = [];
		for (const match of sorted) {
			const prev = nonOverlapping[nonOverlapping.length - 1];
			if (prev && match.start < prev.end) {
				continue;
			}
			nonOverlapping.push(match);
		}

		const result: ILinkDetectorMatch[] = [];
		for (const match of nonOverlapping) {
			let url = match.text;
			let tooltip = match.text;
			switch (match.kind) {
				case "www":
					url = `http://${match.text}`;
					tooltip = url;
					break;
				case "email":
					url = `mailto:${match.text}`;
					break;
				default:
					break;
			}
			result.push({
				start: match.start,
				end: match.end,
				url,
				tooltip,
				kind: match.kind
			});
		}
		return result;
	}

	public static detectModel(model: ITextModel): IDetectedLink[] {
		const links: IDetectedLink[] = [];
		const lineCount = model.getLineCount();
		for (let line = 1; line <= lineCount; line++) {
			const matches = LinkDetector.detect(model.getLineContent(line));
			for (const match of matches) {
				links.push({
					range: {
						startLineNumber: line,
						startColumn: match.start + 1,
						endLineNumber: line,
						endColumn: match.end + 1
					},
					url: match.url,
					tooltip: match.tooltip
				});
			}
		}
		return links;
	}

	public static isLinkLike(text: string): boolean {
		return LinkDetector.detect(text).length > 0;
	}

	private static _findMatches(regex: RegExp, text: string): { start: number; end: number; text: string }[] {
		const matches: { start: number; end: number; text: string }[] = [];
		regex.lastIndex = 0;
		for (const m of text.matchAll(regex)) {
			matches.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, text: m[0] });
		}
		return matches;
	}
}

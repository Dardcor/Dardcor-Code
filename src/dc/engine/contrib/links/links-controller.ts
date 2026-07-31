/**
 * Dardcor Code - Clickable File & URL Hyperlink Detector
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { ITextModel, IRange } from "../../model/text-model.js";

export interface ILink {
	readonly range: IRange;
	readonly url: string;
	readonly tooltip: string;
}

export interface ILinkHost {
	getContainer(): HTMLElement;
	getCoordinates(lineNumber: number, column: number): { x: number; y: number; height: number } | null;
	openExternal(url: string): void;
}

const URL_RE = /\b(?:https?:\/\/|ftp:\/\/)[^\s"'<>(){}[\]]+(?:[^\s"'<>(){}[\].,;:!?]|$)/g;
const MAIL_RE = /\bmailto:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const WWW_RE = /\bwww\.[A-Za-z0-9.-]+\.[A-Za-z]{2,}[^\s"'<>(){}[\]]*/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

function findMatches(regex: RegExp, text: string, offset: number): { start: number; end: number; url: string }[] {
	const matches: { start: number; end: number; url: string }[] = [];
	regex.lastIndex = 0;
	for (const m of text.matchAll(regex)) {
		matches.push({ start: (m.index ?? 0) + offset, end: (m.index ?? 0) + m[0].length + offset, url: m[0] });
	}
	return matches;
}

export class LinksController extends Disposable {
	private readonly _host: ILinkHost;
	private readonly _domNode: HTMLElement;
	private _model: ITextModel | null = null;
	private _links: ILink[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidOpen = this._register(new Emitter<ILink>());
	readonly onDidOpen: Event<ILink> = this._onDidOpen.event;

	constructor(host: ILinkHost) {
		super();
		this._host = host;
		this._domNode = $<HTMLElement>("div", "dc-links-layer");
		this._domNode.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:8;";
		host.getContainer().appendChild(this._domNode);
	}

	public setModel(model: ITextModel | null): void {
		this._model = model;
		this.refresh();
	}

	public refresh(): void {
		const model = this._model;
		clearNode(this._domNode);
		this._links = [];
		if (model) {
			this._links = this.computeLinks(model);
			this._render();
		}
		this._onDidChange.fire();
	}

	public computeLinks(model: ITextModel): ILink[] {
		const links: ILink[] = [];
		const lineCount = model.getLineCount();
		for (let line = 1; line <= lineCount; line++) {
			const text = model.getLineContent(line);
			const found: { start: number; end: number; url: string; kind: "url" | "email" | "www" }[] = [];
			found.push(...findMatches(URL_RE, text, 0).map(m => ({ ...m, kind: "url" as const })));
			found.push(...findMatches(MAIL_RE, text, 0).map(m => ({ ...m, kind: "url" as const })));
			found.push(...findMatches(WWW_RE, text, 0).map(m => ({ ...m, kind: "www" as const })));
			found.push(...findMatches(EMAIL_RE, text, 0).map(m => ({ ...m, kind: "email" as const })));
			// Keep the longest match when overlapping (e.g. www. inside https://)
			const sorted = found.sort((a, b) => a.start - b.start || b.end - a.end);
			const nonOverlapping: { start: number; end: number; url: string; kind: "url" | "email" | "www" }[] = [];
			for (const match of sorted) {
				const prev = nonOverlapping[nonOverlapping.length - 1];
				if (prev && match.start < prev.end) {
					continue;
				}
				nonOverlapping.push(match);
			}
			for (const match of nonOverlapping) {
				let url = match.url;
				let tooltip = url;
				if (match.kind === "www") {
					url = `http://${url}`;
					tooltip = url;
				} else if (match.kind === "email") {
					url = `mailto:${url}`;
				}
				links.push({
					range: { startLineNumber: line, startColumn: match.start + 1, endLineNumber: line, endColumn: match.end + 1 },
					url,
					tooltip
				});
			}
		}
		return links;
	}

	private _render(): void {
		clearNode(this._domNode);
		for (const link of this._links) {
			const anchor = this._host.getCoordinates(link.range.startLineNumber, link.range.startColumn);
			if (!anchor) {
				continue;
			}
			const el = $<HTMLAnchorElement>("a", "dc-link");
			el.href = link.url;
			el.textContent = link.tooltip;
			el.title = link.tooltip;
			el.style.cssText = `position:absolute;left:${anchor.x}px;top:${anchor.y}px;color:#3794ff;text-decoration:underline;pointer-events:auto;cursor:pointer;white-space:pre;font-family:Consolas, monospace;font-size:14px;`;
			this._register(addDisposableListener(el, "click", e => {
				e.preventDefault();
				e.stopPropagation();
				this._onDidOpen.fire(link);
				this._host.openExternal(link.url);
			}));
			this._domNode.appendChild(el);
		}
	}

	public getLinks(): readonly ILink[] {
		return this._links;
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}

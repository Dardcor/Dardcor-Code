/**
 * Dardcor Code - Hover Markdown Doc Renderer
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { $, clearNode } from "../../../core/dom/element.js";

export class MarkdownString {
	public value: string;
	public isTrusted: boolean;
	public supportHtml: boolean;

	constructor(value: string = "", isTrusted: boolean = false, supportHtml: boolean = false) {
		this.value = value;
		this.isTrusted = isTrusted;
		this.supportHtml = supportHtml;
	}

	public appendText(value: string): MarkdownString {
		this.value += value;
		return this;
	}

	public appendMarkdown(value: string): MarkdownString {
		this.value += value;
		return this;
	}
}

export type MarkedString = string | MarkdownString | { language: string; value: string };

function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderInline(value: string): string {
	let out = escapeHtml(value);
	out = out.replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`);
	out = out.replace(/\*\*([^*]+)\*\*/g, (_m, text: string) => `<strong>${text}</strong>`);
	out = out.replace(/\*([^*]+)\*/g, (_m, text: string) => `<em>${text}</em>`);
	out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, (_m, text: string, url: string) => `<a href="${url}" target="_blank" rel="noreferrer">${text}</a>`);
	return out;
}

export function renderMarkdownAsHtml(value: string): string {
	const lines = value.split(/\r?\n/);
	const parts: string[] = [];
	let inCode = false;
	let codeLang = "";
	let codeLines: string[] = [];
	let listOpen = false;

	const flushList = () => {
		if (listOpen) {
			parts.push("</ul>");
			listOpen = false;
		}
	};
	const flushCode = () => {
		if (inCode) {
			parts.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
			inCode = false;
			codeLines = [];
		}
	};

	for (const line of lines) {
		const fence = /^```([\w+-]*)\s*$/.exec(line);
		if (fence) {
			flushList();
			if (inCode) {
				flushCode();
			} else {
				inCode = true;
				codeLang = fence[1];
			}
			continue;
		}
		if (inCode) {
			codeLines.push(line);
			continue;
		}
		flushCode();
		if (/^\s*$/.test(line)) {
			flushList();
			continue;
		}
		const heading = /^(#{1,4})\s+(.+)$/.exec(line);
		if (heading) {
			flushList();
			const level = heading[1].length;
			parts.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
			continue;
		}
		const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
		if (bullet) {
			if (!listOpen) {
				parts.push("<ul>");
				listOpen = true;
			}
			parts.push(`<li>${renderInline(bullet[1])}</li>`);
			continue;
		}
		if (/^\s*(---|___|\*\*\*)\s*$/.test(line)) {
			flushList();
			parts.push("<hr>");
			continue;
		}
		flushList();
		parts.push(`<p>${renderInline(line)}</p>`);
	}
	flushList();
	flushCode();
	return parts.join("");
}

export class MarkdownHover extends Disposable {
	static renderToDom(marked: MarkedString): HTMLElement {
		const node = $<HTMLElement>("div", "dc-markdown-hover");
		if (typeof marked === "string") {
			node.innerHTML = renderMarkdownAsHtml(marked);
		} else if (marked instanceof MarkdownString) {
			node.innerHTML = marked.supportHtml && marked.isTrusted ? marked.value : renderMarkdownAsHtml(marked.value);
		} else if (marked && typeof marked === "object" && "value" in marked) {
			node.innerHTML = `<pre><code>${escapeHtml(marked.value)}</code></pre>`;
		}
		return node;
	}

	public getDomNode(content: string | MarkdownString): HTMLElement {
		const node = $<HTMLElement>("div", "dc-markdown-hover");
		clearNode(node);
		node.innerHTML = renderMarkdownAsHtml(typeof content === "string" ? content : content.value);
		return node;
	}
}

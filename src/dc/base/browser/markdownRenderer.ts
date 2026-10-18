/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from '../common/errors.js';
import { escapeDoubleQuotes, IMarkdownString, isPortableLinkTarget, MarkdownStringTrustedOptions, parseHrefAndDimensions, removeMarkdownEscapes } from '../common/htmlContent.js';
import { markdownEscapeEscapedIcons } from '../common/iconLabels.js';
import { defaultGenerator } from '../common/idGenerator.js';
import { KeyCode } from '../common/keyCodes.js';
import { DisposableStore, IDisposable } from '../common/lifecycle.js';
import * as marked from '../common/marked/marked.js';
import { parse } from '../common/marshalling.js';
import { FileAccess, Schemas } from '../common/network.js';
import { cloneAndChange } from '../common/objects.js';
import { basename as pathBasename } from '../common/path.js';
import { basename, dirname, resolvePath } from '../common/resources.js';
import { escape } from '../common/strings.js';
import { URI, UriComponents } from '../common/uri.js';
import * as DOM from './dom.js';
import * as domSanitize from './domSanitize.js';
import { convertTagToPlaintext } from './domSanitize.js';
import { StandardKeyboardEvent } from './keyboardEvent.js';
import { StandardMouseEvent } from './mouseEvent.js';
import { renderIcon, renderLabelWithIcons } from './ui/iconLabel/iconLabels.js';

export type MarkdownActionHandler = (linkContent: string, mdStr: IMarkdownString) => void;

export interface MarkdownRenderOptions {
	readonly codeBlockRenderer?: (languageId: string, value: string) => Promise<HTMLElement>;
	readonly codeBlockRendererSync?: (languageId: string, value: string, raw?: string) => HTMLElement;
	readonly asyncRenderCallback?: () => void;

	readonly actionHandler?: MarkdownActionHandler;

	readonly transformUri?: (href: string, kind: 'link' | 'image') => string;

	readonly fillInIncompleteTokens?: boolean;

	readonly sanitizerConfig?: MarkdownSanitizerConfig;

	readonly markedOptions?: MarkdownRendererMarkedOptions;
	readonly markedExtensions?: marked.MarkedExtension[];
}

export interface MarkdownRendererMarkedOptions {
	readonly gfm?: boolean;
	readonly breaks?: boolean;
}

export interface MarkdownSanitizerConfig {
	readonly replaceWithPlaintext?: boolean;
	readonly allowedTags?: {
		readonly override: readonly string[];
	};
	readonly allowedAttributes?: {
		readonly override: ReadonlyArray<string | domSanitize.SanitizeAttributeRule>;
	};
	readonly allowedLinkSchemes?: {
		readonly augment: readonly string[];
	};
	readonly remoteImageIsAllowed?: (uri: URI) => boolean;
}

function getLinkTitle(href: string): string {
	try {
		const parsed = URI.parse(href);
		if (parsed.scheme === Schemas.file) {
			const path = parsed.fsPath;
			const fragment = parsed.fragment;
			return escapeDoubleQuotes(fragment ? `${path}#${fragment}` : path);
		}
	} catch {
	}
	return '';
}

function renderImage({ href, title, text }: marked.Tokens.Image, transformUri?: (href: string) => string): string {
	let dimensions: string[] = [];
	let attributes: string[] = [];
	if (href) {
		({ href, dimensions } = parseHrefAndDimensions(href));
		href = transformUri?.(href) ?? href;
		attributes.push(`src="${escapeDoubleQuotes(href)}"`);
	}
	if (text) {
		attributes.push(`alt="${escapeDoubleQuotes(text)}"`);
	}
	if (title) {
		attributes.push(`title="${escapeDoubleQuotes(title)}"`);
	}
	if (dimensions.length) {
		attributes = attributes.concat(dimensions);
	}
	return '<img ' + attributes.join(' ') + '>';
}

const defaultMarkedRenderers = Object.freeze({
	image: renderImage,
	paragraph(this: marked.Renderer, { tokens }: marked.Tokens.Paragraph): string {
		return `<p>${this.parser.parseInline(tokens)}</p>`;
	},

	link(this: marked.Renderer, { href, title, tokens }: marked.Tokens.Link): string {
		let text = this.parser.parseInline(tokens);
		if (typeof href !== 'string') {
			return '';
		}

		if (href === text) {
			text = removeMarkdownEscapes(text);
		}

		title = typeof title === 'string' ? escapeDoubleQuotes(removeMarkdownEscapes(title)) : '';
		href = removeMarkdownEscapes(href);

		if (!title && href.startsWith(`${Schemas.file}:`)) {
			title = getLinkTitle(href);
		}

		const isCommandUri = href.startsWith(`${Schemas.command}:`);

		href = href.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');

		const effectiveTitle = title || (isCommandUri ? '' : href);
		return `<a href="${href}" title="${effectiveTitle}" draggable="false">${text}</a>`;
	},
});

function createAlertBlockquoteRenderer(fallbackRenderer: (this: marked.Renderer, token: marked.Tokens.Blockquote) => string) {
	return function (this: marked.Renderer, token: marked.Tokens.Blockquote): string {
		const { tokens } = token;
		const firstToken = tokens[0];
		if (firstToken?.type !== 'paragraph') {
			return fallbackRenderer.call(this, token);
		}

		const paragraphTokens = firstToken.tokens;
		if (!paragraphTokens || paragraphTokens.length === 0) {
			return fallbackRenderer.call(this, token);
		}

		const firstTextToken = paragraphTokens[0];
		if (firstTextToken?.type !== 'text') {
			return fallbackRenderer.call(this, token);
		}

		const pattern = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*?\n*/i;
		const match = firstTextToken.raw.match(pattern);
		if (!match) {
			return fallbackRenderer.call(this, token);
		}

		firstTextToken.raw = firstTextToken.raw.replace(pattern, '');
		firstTextToken.text = firstTextToken.text.replace(pattern, '');

		const alertIcons: Record<string, string> = {
			'note': 'info',
			'tip': 'light-bulb',
			'important': 'comment',
			'warning': 'alert',
			'caution': 'stop'
		};

		const type = match[1];
		const typeCapitalized = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
		const severity = type.toLowerCase();
		const iconHtml = renderIcon({ id: alertIcons[severity] }).outerHTML;

		const content = this.parser.parse(tokens);

		return `<blockquote data-severity="${severity}"><p><span>${iconHtml}${typeCapitalized}</span>${content.substring(3)}</blockquote>\n`;
	};
}

export interface IRenderedMarkdown extends IDisposable {
	readonly element: HTMLElement;
}

export function renderMarkdown(markdown: IMarkdownString, options: MarkdownRenderOptions = {}, target?: HTMLElement): IRenderedMarkdown {
	const disposables = new DisposableStore();
	let isDisposed = false;

	const markedInstance = new marked.Marked(...(options.markedExtensions ?? []));
	const { renderer, codeBlocks, syncCodeBlocks } = createMarkdownRenderer(markedInstance, options, markdown);
	const value = preprocessMarkdownString(markdown);

	let renderedMarkdown: string;
	if (options.fillInIncompleteTokens) {
		const opts: marked.MarkedOptions = {
			...markedInstance.defaults,
			...options.markedOptions,
			renderer
		};
		const tokens = markedInstance.lexer(value, opts);
		const newTokens = fillInIncompleteTokens(tokens);
		renderedMarkdown = markedInstance.parser(newTokens, opts);
	} else {
		renderedMarkdown = markedInstance.parse(value, { ...options?.markedOptions, renderer, async: false });
	}

	if (markdown.supportThemeIcons) {
		const elements = renderLabelWithIcons(renderedMarkdown);
		renderedMarkdown = elements.map(e => typeof e === 'string' ? e : e.outerHTML).join('');
	}

	const renderedContent = document.createElement('div');
	const sanitizerConfig = getDomSanitizerConfig(markdown, options.sanitizerConfig ?? {});
	domSanitize.safeSetInnerHtml(renderedContent, renderedMarkdown, sanitizerConfig);

	rewriteRenderedLinks(markdown, options, renderedContent);

	let outElement: HTMLElement;
	if (target) {
		outElement = target;
		DOM.reset(target, ...renderedContent.childNodes);
	} else {
		outElement = renderedContent;
	}

	if (codeBlocks.length > 0) {
		Promise.all(codeBlocks).then((tuples) => {
			if (isDisposed) {
				return;
			}
			const renderedElements = new Map(tuples);
			// eslint-disable-next-line no-restricted-syntax
			const placeholderElements = outElement.querySelectorAll<HTMLDivElement>(`div[data-code]`);
			for (const placeholderElement of placeholderElements) {
				const renderedElement = renderedElements.get(placeholderElement.dataset['code'] ?? '');
				if (renderedElement) {
					DOM.reset(placeholderElement, renderedElement);
				}
			}
			options.asyncRenderCallback?.();
		});
	} else if (syncCodeBlocks.length > 0) {
		const renderedElements = new Map(syncCodeBlocks);
		// eslint-disable-next-line no-restricted-syntax
		const placeholderElements = outElement.querySelectorAll<HTMLDivElement>(`div[data-code]`);
		for (const placeholderElement of placeholderElements) {
			const renderedElement = renderedElements.get(placeholderElement.dataset['code'] ?? '');
			if (renderedElement) {
				DOM.reset(placeholderElement, renderedElement);
			}
		}
	}

	if (options.asyncRenderCallback) {
		// eslint-disable-next-line no-restricted-syntax
		for (const img of outElement.getElementsByTagName('img')) {
			const listener = disposables.add(DOM.addDisposableListener(img, 'load', () => {
				listener.dispose();
				options.asyncRenderCallback!();
			}));
		}
	}

	if (options.actionHandler) {
		const clickCb = (e: PointerEvent) => {
			const mouseEvent = new StandardMouseEvent(DOM.getWindow(outElement), e);
			if (!mouseEvent.leftButton && !mouseEvent.middleButton) {
				return;
			}
			activateLink(markdown, options, mouseEvent);
		};
		disposables.add(DOM.addDisposableListener(outElement, 'click', clickCb));
		disposables.add(DOM.addDisposableListener(outElement, 'auxclick', clickCb));

		disposables.add(DOM.addDisposableListener(outElement, 'keydown', (e) => {
			const keyboardEvent = new StandardKeyboardEvent(e);
			if (!keyboardEvent.equals(KeyCode.Space) && !keyboardEvent.equals(KeyCode.Enter)) {
				return;
			}
			activateLink(markdown, options, keyboardEvent);
		}));

	}

	// eslint-disable-next-line no-restricted-syntax
	for (const input of [...outElement.getElementsByTagName('input')]) {
		if (input.attributes.getNamedItem('type')?.value === 'checkbox') {
			input.setAttribute('disabled', '');
		} else {
			if (options.sanitizerConfig?.replaceWithPlaintext) {
				const replacement = convertTagToPlaintext(input);
				if (replacement) {
					input.parentElement?.replaceChild(replacement, input);
				} else {
					input.remove();
				}
			} else {
				input.remove();
			}
		}
	}

	return {
		element: outElement,
		dispose: () => {
			isDisposed = true;
			disposables.dispose();
		}
	};
}

function rewriteRenderedLinks(markdown: IMarkdownString, options: MarkdownRenderOptions, root: HTMLElement) {
	// eslint-disable-next-line no-restricted-syntax
	for (const el of root.querySelectorAll('img, audio, video, source')) {
		const src = el.getAttribute('src');
		if (src) {
			let href = src;
			try {
				if (markdown.baseUri) {
					href = resolveWithBaseUri(URI.from(markdown.baseUri), href);
				}
			} catch (err) { }

			el.setAttribute('src', massageHref(markdown, href, true));

			if (options.sanitizerConfig?.remoteImageIsAllowed) {
				const uri = URI.parse(href);
				if (uri.scheme !== Schemas.file && uri.scheme !== Schemas.data && !options.sanitizerConfig.remoteImageIsAllowed(uri)) {
					el.replaceWith(DOM.$('', undefined, el.outerHTML));
				}
			}
		}
	}

	// eslint-disable-next-line no-restricted-syntax
	for (const el of root.querySelectorAll('a')) {
		const href = el.getAttribute('href');
		el.setAttribute('href', '');
		if (!href
			|| /^data:|javascript:/i.test(href)
			|| (/^command:/i.test(href) && !markdown.isTrusted)
			|| /^command:(\/\/\/)?_workbench\.downloadResource/i.test(href)) {
			el.replaceWith(...el.childNodes);
		} else {
			let resolvedHref = massageHref(markdown, href, false);
			if (markdown.baseUri) {
				resolvedHref = resolveWithBaseUri(URI.from(markdown.baseUri), href);
			}
			el.dataset.href = resolvedHref;

			if (options.actionHandler && isPortableLinkTarget(resolvedHref)) {
				el.setAttribute('href', resolvedHref);
			}
		}
	}
}


function createMarkdownRenderer(marked: marked.Marked, options: MarkdownRenderOptions, markdown: IMarkdownString): { renderer: marked.Renderer; codeBlocks: Promise<[string, HTMLElement]>[]; syncCodeBlocks: [string, HTMLElement][] } {
	const renderer = new marked.Renderer(options.markedOptions);
	renderer.image = token => renderImage(token, href => options.transformUri?.(href, 'image') ?? href);
	renderer.link = token => defaultMarkedRenderers.link.call(renderer, {
		...token,
		href: options.transformUri?.(token.href, 'link') ?? token.href,
	});
	renderer.paragraph = defaultMarkedRenderers.paragraph;

	if (markdown.supportAlertSyntax) {
		renderer.blockquote = createAlertBlockquoteRenderer(renderer.blockquote);
	}

	const codeBlocks: Promise<[string, HTMLElement]>[] = [];
	const syncCodeBlocks: [string, HTMLElement][] = [];

	if (options.codeBlockRendererSync) {
		renderer.code = ({ text, lang, raw }: marked.Tokens.Code) => {
			const id = defaultGenerator.nextId();
			const value = options.codeBlockRendererSync!(postProcessCodeBlockLanguageId(lang), text, raw);
			syncCodeBlocks.push([id, value]);
			return `<div class="code" data-code="${id}">${escape(text)}</div>`;
		};
	} else if (options.codeBlockRenderer) {
		renderer.code = ({ text, lang }: marked.Tokens.Code) => {
			const id = defaultGenerator.nextId();
			const value = options.codeBlockRenderer!(postProcessCodeBlockLanguageId(lang), text);
			codeBlocks.push(value.then(element => [id, element]));
			return `<div class="code" data-code="${id}">${escape(text)}</div>`;
		};
	}

	if (!markdown.supportHtml) {
		renderer.html = ({ text }) => {
			if (options.sanitizerConfig?.replaceWithPlaintext) {
				return escape(text);
			}

			const match = markdown.isTrusted ? text.match(/^(<span[^>]+>)|(<\/\s*span>)$/) : undefined;
			return match ? text : '';
		};
	}
	return { renderer, codeBlocks, syncCodeBlocks };
}

function preprocessMarkdownString(markdown: IMarkdownString) {
	let value = markdown.value;

	if (value.length > 100_000) {
		value = `${value.substr(0, 100_000)}…`;
	}

	if (markdown.supportThemeIcons) {
		value = markdownEscapeEscapedIcons(value);
	}

	return value;
}

function activateLink(mdStr: IMarkdownString, options: MarkdownRenderOptions, event: StandardMouseEvent | StandardKeyboardEvent): void {
	const target = event.target.closest('a[data-href]');
	if (!DOM.isHTMLElement(target)) {
		return;
	}

	try {
		let href = target.dataset['href'];
		if (href) {
			if (mdStr.baseUri) {
				href = resolveWithBaseUri(URI.from(mdStr.baseUri), href);
			}
			options.actionHandler?.(href, mdStr);
		}
	} catch (err) {
		onUnexpectedError(err);
	} finally {
		event.preventDefault();
		event.stopPropagation();
	}
}

function uriMassage(markdown: IMarkdownString, part: string): string {
	let data: unknown;
	try {
		data = parse(decodeURIComponent(part));
	} catch (e) {
	}
	if (!data) {
		return part;
	}
	data = cloneAndChange(data, value => {
		if (markdown.uris && markdown.uris[value]) {
			return URI.revive(markdown.uris[value]);
		} else {
			return undefined;
		}
	});
	return encodeURIComponent(JSON.stringify(data));
}

function massageHref(markdown: IMarkdownString, href: string, isDomUri: boolean): string {
	const data = markdown.uris && markdown.uris[href];
	let uri = URI.revive(data);
	if (isDomUri) {
		if (href.startsWith(Schemas.data + ':')) {
			return href;
		}
		if (!uri) {
			uri = URI.parse(href);
		}
		return FileAccess.uriToBrowserUri(uri).toString(true);
	}
	if (!uri) {
		return href;
	}
	if (URI.parse(href).toString() === uri.toString()) {
		return href;
	}
	if (uri.query) {
		uri = uri.with({ query: uriMassage(markdown, uri.query) });
	}
	return uri.toString();
}

function postProcessCodeBlockLanguageId(lang: string | undefined): string {
	if (!lang) {
		return '';
	}

	const parts = lang.split(/[\s+|:|,|\{|\?]/, 1);
	if (parts.length) {
		return parts[0];
	}
	return lang;
}

function resolveWithBaseUri(baseUri: URI, href: string): string {
	const hasScheme = /^\w[\w\d+.-]*:/.test(href);
	if (hasScheme) {
		return href;
	}

	if (baseUri.path.endsWith('/')) {
		return resolvePath(baseUri, href).toString();
	} else {
		return resolvePath(dirname(baseUri), href).toString();
	}
}

type MdStrConfig = {
	readonly isTrusted?: boolean | MarkdownStringTrustedOptions;
	readonly baseUri?: UriComponents;
};

function sanitizeRenderedMarkdown(
	renderedMarkdown: string,
	originalMdStrConfig: MdStrConfig,
	options: MarkdownSanitizerConfig = {},
): TrustedHTML {
	const sanitizerConfig = getDomSanitizerConfig(originalMdStrConfig, options);
	return domSanitize.sanitizeHtml(renderedMarkdown, sanitizerConfig);
}

export const allowedMarkdownHtmlTags = Object.freeze([
	...domSanitize.basicMarkupHtmlTags,
	'input',
]);

export const allowedMarkdownHtmlAttributes = Object.freeze<Array<string | domSanitize.SanitizeAttributeRule>>([
	'align',
	'autoplay',
	'alt',
	'colspan',
	'controls',
	'draggable',
	'height',
	'href',
	'loop',
	'muted',
	'playsinline',
	'poster',
	'rowspan',
	'src',
	'target',
	'title',
	'type',
	'width',
	'start',

	'checked',
	'disabled',
	'value',

	'data-code',
	'data-href',
	'data-severity',

	{
		attributeName: 'style',
		shouldKeep: (element, data) => {
			if (element.tagName === 'SPAN') {
				if (data.attrName === 'style') {
					return /^(color\:(#[0-9a-fA-F]+|var\(--vscode(-[a-zA-Z0-9]+)+\));)?(background-color\:(#[0-9a-fA-F]+|var\(--vscode(-[a-zA-Z0-9]+)+\));)?(border-radius:[0-9]+px;)?$/.test(data.attrValue);
				}
			}
			return false;
		}
	},

	{
		attributeName: 'class',
		shouldKeep: (element, data) => {
			if (element.tagName === 'SPAN') {
				if (data.attrName === 'class') {
					return /^codicon codicon-[a-z\-]+( codicon-modifier-[a-z\-]+)?$/.test(data.attrValue);
				}
			}
			return false;
		},
	},
]);

function getDomSanitizerConfig(mdStrConfig: MdStrConfig, options: MarkdownSanitizerConfig): domSanitize.DomSanitizerConfig {
	const isTrusted = mdStrConfig.isTrusted ?? false;
	const allowedLinkSchemes = [
		Schemas.http,
		Schemas.https,
		Schemas.mailto,
		Schemas.file,
		Schemas.vscodeFileResource,
		Schemas.vscodeRemote,
		Schemas.vscodeRemoteResource,
		Schemas.vscodeNotebookCell,
		Schemas.internal,
	];

	if (isTrusted) {
		allowedLinkSchemes.push(Schemas.command);
	}

	if (options.allowedLinkSchemes?.augment) {
		allowedLinkSchemes.push(...options.allowedLinkSchemes.augment);
	}

	return {
		allowedTags: {
			override: options.allowedTags?.override ?? allowedMarkdownHtmlTags
		},
		allowedAttributes: {
			override: options.allowedAttributes?.override ?? allowedMarkdownHtmlAttributes,
		},
		allowedLinkProtocols: {
			override: allowedLinkSchemes,
		},
		allowRelativeLinkPaths: !!mdStrConfig.baseUri,
		allowedMediaProtocols: {
			override: [
				Schemas.http,
				Schemas.https,
				Schemas.data,
				Schemas.file,
				Schemas.vscodeFileResource,
				Schemas.vscodeRemote,
				Schemas.vscodeRemoteResource,
			]
		},
		allowRelativeMediaPaths: !!mdStrConfig.baseUri,
		replaceWithPlaintext: options.replaceWithPlaintext,
	};
}

export function renderAsPlaintext(str: IMarkdownString | string, options?: {
	readonly includeCodeBlocksFences?: boolean;
	readonly useLinkFormatter?: boolean;
}) {
	if (typeof str === 'string') {
		return str;
	}

	let value = str.value ?? '';
	if (value.length > 100_000) {
		value = `${value.substr(0, 100_000)}…`;
	}

	const renderer = createPlainTextRenderer();
	if (options?.includeCodeBlocksFences) {
		renderer.code = codeBlockFences;
	}
	if (options?.useLinkFormatter) {
		renderer.link = linkFormatter;
	}

	const html = marked.parse(value, { async: false, renderer });
	return sanitizeRenderedMarkdown(html, { isTrusted: false }, {})
		.toString()
		.replace(/&(#\d+|[a-zA-Z]+);/g, m => unescapeInfo.get(m) ?? m)
		.trim();
}

const unescapeInfo = new Map<string, string>([
	['&quot;', '"'],
	['&nbsp;', ' '],
	['&amp;', '&'],
	['&#39;', '\''],
	['&lt;', '<'],
	['&gt;', '>'],
]);

function createPlainTextRenderer(): marked.Renderer {
	const renderer = new marked.Renderer();

	renderer.code = ({ text }: marked.Tokens.Code): string => {
		return escape(text);
	};
	renderer.blockquote = ({ text }: marked.Tokens.Blockquote): string => {
		return text + '\n';
	};
	renderer.html = (_: marked.Tokens.HTML): string => {
		return '';
	};
	renderer.heading = function ({ tokens }: marked.Tokens.Heading): string {
		return this.parser.parseInline(tokens) + '\n';
	};
	renderer.hr = (): string => {
		return '';
	};
	renderer.list = function ({ items }: marked.Tokens.List): string {
		return items.map(x => this.listitem(x)).join('\n') + '\n';
	};
	renderer.listitem = ({ text }: marked.Tokens.ListItem): string => {
		return text + '\n';
	};
	renderer.paragraph = function ({ tokens }: marked.Tokens.Paragraph): string {
		return this.parser.parseInline(tokens) + '\n';
	};
	renderer.table = function ({ header, rows }: marked.Tokens.Table): string {
		return header.map(cell => this.tablecell(cell)).join(' ') + '\n' + rows.map(cells => cells.map(cell => this.tablecell(cell)).join(' ')).join('\n') + '\n';
	};
	renderer.tablerow = ({ text }: marked.Tokens.TableRow): string => {
		return text;
	};
	renderer.tablecell = function ({ tokens }: marked.Tokens.TableCell): string {
		return this.parser.parseInline(tokens);
	};
	renderer.strong = ({ text }: marked.Tokens.Strong): string => {
		return text;
	};
	renderer.em = ({ text }: marked.Tokens.Em): string => {
		return text;
	};
	renderer.codespan = ({ text }: marked.Tokens.Codespan): string => {
		return text;
	};
	renderer.br = (_: marked.Tokens.Br): string => {
		return '\n';
	};
	renderer.del = ({ text }: marked.Tokens.Del): string => {
		return text;
	};
	renderer.image = (_: marked.Tokens.Image): string => {
		return '';
	};
	renderer.text = ({ text }: marked.Tokens.Text): string => {
		return text;
	};
	renderer.link = ({ text }: marked.Tokens.Link): string => {
		return text;
	};
	return renderer;
}

const codeBlockFences = ({ text }: marked.Tokens.Code): string => {
	return `\n\`\`\`\n${escape(text)}\n\`\`\`\n`;
};

const linkFormatter = ({ text, href }: marked.Tokens.Link): string => {
	try {
		if (href) {
			const uri = URI.parse(href);
			return text.trim() || basename(uri);
		}
	} catch (e) {
		return text.trim() || pathBasename(href);
	}
	return text;
};

function mergeRawTokenText(tokens: marked.Token[]): string {
	let mergedTokenText = '';
	tokens.forEach(token => {
		mergedTokenText += token.raw;
	});
	return mergedTokenText;
}

function completeSingleLinePattern(token: marked.Tokens.Text | marked.Tokens.Paragraph): marked.Token | undefined {
	if (!token.tokens) {
		return undefined;
	}

	for (let i = token.tokens.length - 1; i >= 0; i--) {
		const subtoken = token.tokens[i];
		if (subtoken.type === 'text') {
			const lines = subtoken.raw.split('\n');
			const lastLine = lines[lines.length - 1];

			if (
				hasLinkTextAndStartOfLinkTarget(lastLine) ||
				hasStartOfLinkTargetAndNoLinkText(lastLine) && token.tokens.slice(0, i).some(t => t.type === 'text' && t.raw.match(/\[[^\]]*$/))
			) {
				const nextTwoSubTokens = token.tokens.slice(i + 1);

				if (
					nextTwoSubTokens[0]?.type === 'link' && nextTwoSubTokens[1]?.type === 'text' && nextTwoSubTokens[1].raw.match(/^ *"[^"]*$/) ||
					lastLine.match(/^[^"]* +"[^"]*$/)
				) {

					return completeLinkTargetArg(token);
				}
				return completeLinkTarget(token);
			}

			else if (lastLine.includes('`')) {
				return completeCodespan(token);
			}

			else if (lastLine.includes('**')) {
				return completeDoublestar(token);
			}

			else if (lastLine.match(/\*\w/)) {
				return completeStar(token);
			}

			else if (lastLine.match(/(^|\s)__\w/)) {
				return completeDoubleUnderscore(token);
			}

			else if (lastLine.match(/(^|\s)_\w/)) {
				return completeUnderscore(token);
			}

			else if (lastLine.match(/(^|\s)\[\w*[^\]]*$/)) {
				return completeLinkText(token);
			}
		}
	}

	return undefined;
}

function hasLinkTextAndStartOfLinkTarget(str: string): boolean {
	return !!str.match(/(?:^|[\s(*_~])\[.*\]\(\w*/);
}

function hasStartOfLinkTargetAndNoLinkText(str: string): boolean {
	return !!str.match(/^[^\[]*\]\([^\)]*$/);
}

function completeBlockquotePattern(blockquote: marked.Tokens.Blockquote, links: marked.Links): marked.Tokens.Blockquote | undefined {
	let lastInterestingIndex = blockquote.tokens.length - 1;
	while (lastInterestingIndex >= 0 && blockquote.tokens[lastInterestingIndex].type === 'space') {
		lastInterestingIndex--;
	}

	const lastToken = blockquote.tokens[lastInterestingIndex];
	if (lastToken?.type !== 'paragraph') {
		return undefined;
	}

	const completedToken = completeSingleLinePattern(lastToken as marked.Tokens.Paragraph);
	if (!completedToken) {
		return undefined;
	}

	const completion = completedToken.raw.slice(lastToken.raw.trimEnd().length);
	const trailingQuoteOnlyLines = blockquote.raw.match(/(?:\n[ \t]*>[ \t]*(?=\n|$))+\n?$/)?.[0] ?? '';
	const insertionIndex = blockquote.raw.length - trailingQuoteOnlyLines.length;
	const completedRaw = blockquote.raw.slice(0, insertionIndex) + completion + trailingQuoteOnlyLines;
	const lexer = new marked.Lexer();
	lexer.tokens.links = links;
	const completedBlockquote = lexer.lex(completedRaw)[0];
	if (completedBlockquote.type === 'blockquote') {
		return completedBlockquote as marked.Tokens.Blockquote;
	}

	return undefined;
}

function completeListItemPattern(list: marked.Tokens.List): marked.Tokens.List | undefined {
	const lastListItem = list.items[list.items.length - 1];
	const lastListSubToken = lastListItem.tokens ? lastListItem.tokens[lastListItem.tokens.length - 1] : undefined;


	const listEndsInHeading = (list: marked.Tokens.List): boolean => {
		const lastItem = list.items.at(-1);
		const lastToken = lastItem?.tokens.at(-1);
		return lastToken?.type === 'heading' || lastToken?.type === 'list' && listEndsInHeading(lastToken as marked.Tokens.List);
	};

	let newToken: marked.Token | undefined;
	if (lastListSubToken?.type === 'text' && !('inRawBlock' in lastListItem)) {
		newToken = completeSingleLinePattern(lastListSubToken as marked.Tokens.Text);
	} else if (listEndsInHeading(list)) {
		const newList = marked.lexer(list.raw.trim() + ' &nbsp;')[0] as marked.Tokens.List;
		if (newList.type !== 'list') {
			return;
		}
		return newList;
	}

	if (!newToken || newToken.type !== 'paragraph') {
		return;
	}

	const previousListItemsText = mergeRawTokenText(list.items.slice(0, -1));

	const lastListItemLead = lastListItem.raw.match(/^(\s*(-|\d+\.|\*) +)/)?.[0];
	if (!lastListItemLead) {
		return;
	}

	const newListItemText = lastListItemLead +
		mergeRawTokenText(lastListItem.tokens.slice(0, -1)) +
		newToken.raw;

	const newList = marked.lexer(previousListItemsText + newListItemText)[0] as marked.Tokens.List;
	if (newList.type !== 'list') {
		return;
	}

	return newList;
}

function completeHeading(token: marked.Tokens.Heading, fullRawText: string): marked.TokensList | void {
	if (token.raw.match(/-\s*$/)) {
		return marked.lexer(fullRawText + ' &nbsp;');
	}
}

const maxIncompleteTokensFixRounds = 3;
export function fillInIncompleteTokens(tokens: marked.TokensList): marked.TokensList {
	for (let i = 0; i < maxIncompleteTokensFixRounds; i++) {
		const newTokens = fillInIncompleteTokensOnce(tokens);
		if (newTokens) {
			tokens = newTokens;
		} else {
			break;
		}
	}

	return tokens;
}

function fillInIncompleteTokensOnce(tokens: marked.TokensList): marked.TokensList | null {
	let i: number;
	let newTokens: marked.Token[] | undefined;
	for (i = 0; i < tokens.length; i++) {
		const token = tokens[i];

		if (token.type === 'paragraph' && token.raw.match(/(\n|^)\|/)) {
			newTokens = completeTable(tokens.slice(i));
			break;
		}
	}

	let lastInterestingIdx = tokens.length - 1;
	while (lastInterestingIdx >= 0 && (tokens[lastInterestingIdx].type === 'space' || tokens[lastInterestingIdx].type === 'html')) {
		lastInterestingIdx--;
	}
	const lastInterestingToken = lastInterestingIdx >= 0 ? tokens[lastInterestingIdx] : undefined;
	const trailingTokens = tokens.slice(lastInterestingIdx + 1);

	if (!newTokens && lastInterestingToken?.type === 'list') {
		const newListToken = completeListItemPattern(lastInterestingToken as marked.Tokens.List);
		if (newListToken) {
			newTokens = [newListToken, ...trailingTokens];
			i = lastInterestingIdx;
		}
	}

	if (!newTokens && lastInterestingToken?.type === 'blockquote') {
		const newBlockquoteToken = completeBlockquotePattern(lastInterestingToken as marked.Tokens.Blockquote, tokens.links);
		if (newBlockquoteToken) {
			newTokens = [newBlockquoteToken, ...trailingTokens];
			i = lastInterestingIdx;
		}
	}

	if (!newTokens && lastInterestingToken?.type === 'paragraph') {
		const newToken = completeSingleLinePattern(lastInterestingToken as marked.Tokens.Paragraph);
		if (newToken) {
			newTokens = [newToken, ...trailingTokens];
			i = lastInterestingIdx;
		}
	}

	if (newTokens) {
		const newTokensList = [
			...tokens.slice(0, i),
			...newTokens
		];
		(newTokensList as marked.TokensList).links = tokens.links;
		return newTokensList as marked.TokensList;
	}

	const lastToken = tokens.at(-1);
	if (lastToken?.type === 'heading') {
		const completeTokens = completeHeading(lastToken as marked.Tokens.Heading, mergeRawTokenText(tokens));
		if (completeTokens) {
			return completeTokens;
		}
	}

	return null;
}


function completeCodespan(token: marked.Token): marked.Token {
	return completeWithString(token, '`');
}

function completeStar(tokens: marked.Token): marked.Token {
	return completeWithString(tokens, '*');
}

function completeUnderscore(tokens: marked.Token): marked.Token {
	return completeWithString(tokens, '_');
}

function completeLinkTarget(tokens: marked.Token): marked.Token {
	return completeWithString(tokens, ')', false);
}

function completeLinkTargetArg(tokens: marked.Token): marked.Token {
	return completeWithString(tokens, '")', false);
}

function completeLinkText(tokens: marked.Token): marked.Token {
	return completeWithString(tokens, '](https://microsoft.com)', false);
}

function completeDoublestar(tokens: marked.Token): marked.Token {
	return completeWithString(tokens, '**');
}

function completeDoubleUnderscore(tokens: marked.Token): marked.Token {
	return completeWithString(tokens, '__');
}

function completeWithString(tokens: marked.Token[] | marked.Token, closingString: string, shouldTrim = true): marked.Token {
	const mergedRawText = mergeRawTokenText(Array.isArray(tokens) ? tokens : [tokens]);

	const trimmedRawText = shouldTrim ? mergedRawText.trimEnd() : mergedRawText;
	return marked.lexer(trimmedRawText + closingString)[0];
}

function completeTable(tokens: marked.Token[]): marked.Token[] | undefined {
	const mergedRawText = mergeRawTokenText(tokens);
	const lines = mergedRawText.split('\n');

	let numCols: number | undefined;
	let hasSeparatorRow = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (typeof numCols === 'undefined' && line.match(/^\s*\|/)) {
			const line1Matches = line.match(/(\|[^\|]+)(?=\||$)/g);
			if (line1Matches) {
				numCols = line1Matches.length;
			}
		} else if (typeof numCols === 'number') {
			if (line.match(/^\s*\|/)) {
				if (i !== lines.length - 1) {
					return undefined;
				}

				hasSeparatorRow = true;
			} else {
				return undefined;
			}
		}
	}

	if (typeof numCols === 'number' && numCols > 0) {
		const prefixText = hasSeparatorRow ? lines.slice(0, -1).join('\n') : mergedRawText;
		const line1EndsInPipe = !!prefixText.match(/\|\s*$/);
		const newRawText = prefixText + (line1EndsInPipe ? '' : '|') + `\n|${' --- |'.repeat(numCols)}`;
		return marked.lexer(newRawText);
	}

	return undefined;
}

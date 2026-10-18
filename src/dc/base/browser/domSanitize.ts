/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../common/network.js';
import { reset } from './dom.js';
// eslint-disable-next-line no-restricted-imports
import dompurify, * as DomPurifyTypes from './dompurify/dompurify.js';

export const basicMarkupHtmlTags = Object.freeze([
	'a',
	'abbr',
	'b',
	'bdo',
	'blockquote',
	'br',
	'caption',
	'cite',
	'code',
	'col',
	'colgroup',
	'dd',
	'del',
	'details',
	'dfn',
	'div',
	'dl',
	'dt',
	'em',
	'figcaption',
	'figure',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'hr',
	'i',
	'img',
	'ins',
	'kbd',
	'label',
	'li',
	'mark',
	'ol',
	'p',
	'pre',
	'q',
	'rp',
	'rt',
	'ruby',
	's',
	'samp',
	'small',
	'small',
	'source',
	'span',
	'strike',
	'strong',
	'sub',
	'summary',
	'sup',
	'table',
	'tbody',
	'td',
	'tfoot',
	'th',
	'thead',
	'time',
	'tr',
	'tt',
	'u',
	'ul',
	'var',
	'video',
	'wbr',
]);

export const defaultAllowedAttrs = Object.freeze([
	'href',
	'target',
	'src',
	'alt',
	'title',
	'for',
	'name',
	'role',
	'tabindex',
	'x-dispatch',
	'required',
	'checked',
	'placeholder',
	'type',
	'start',
	'width',
	'height',
	'align',
]);


const fakeRelativeUrlProtocol = 'vscode-relative-path';

interface AllowedLinksConfig {
	readonly override: readonly string[] | '*';
	readonly allowRelativePaths: boolean;
}

function validateLink(value: string, allowedProtocols: AllowedLinksConfig): boolean {
	if (allowedProtocols.override === '*') {
		return true;
	}

	try {
		const url = new URL(value, fakeRelativeUrlProtocol + '://');
		if (allowedProtocols.override.includes(url.protocol.replace(/:$/, ''))) {
			return true;
		}

		if (allowedProtocols.allowRelativePaths
			&& url.protocol === fakeRelativeUrlProtocol + ':'
			&& !value.trim().toLowerCase().startsWith(fakeRelativeUrlProtocol)
		) {
			return true;
		}

		return false;
	} catch (e) {
		return false;
	}
}

function hookDomPurifyHrefAndSrcSanitizer(allowedLinkProtocols: AllowedLinksConfig, allowedMediaProtocols: AllowedLinksConfig) {
	dompurify.addHook('afterSanitizeAttributes', (node) => {
		for (const attr of ['href', 'src']) {
			if (node.hasAttribute(attr)) {
				const attrValue = node.getAttribute(attr) as string;
				if (attr === 'href') {
					if (!attrValue.startsWith('#') && !validateLink(attrValue, allowedLinkProtocols)) {
						node.removeAttribute(attr);
					}
				} else {
					if (!validateLink(attrValue, allowedMediaProtocols)) {
						node.removeAttribute(attr);
					}
				}
			}
		}
	});
}

export type SanitizeAttributePredicate = (node: Element, data: { readonly attrName: string; readonly attrValue: string }) => boolean | string;

export interface SanitizeAttributeRule {
	readonly attributeName: string;
	shouldKeep: SanitizeAttributePredicate;
}


export interface DomSanitizerConfig {
	readonly allowedTags?: {
		readonly override?: readonly string[];
		readonly augment?: readonly string[];
	};

	readonly allowedAttributes?: {
		readonly override?: ReadonlyArray<string | SanitizeAttributeRule>;
		readonly augment?: ReadonlyArray<string | SanitizeAttributeRule>;
	};

	readonly allowedLinkProtocols?: {
		readonly override?: readonly string[] | '*';
	};

	readonly allowRelativeLinkPaths?: boolean;

	readonly allowedMediaProtocols?: {
		readonly override?: readonly string[] | '*';
	};

	readonly allowRelativeMediaPaths?: boolean;

	readonly replaceWithPlaintext?: boolean;
}

const defaultDomPurifyConfig = Object.freeze({
	ALLOWED_TAGS: [...basicMarkupHtmlTags],
	ALLOWED_ATTR: [...defaultAllowedAttrs],
	ALLOW_UNKNOWN_PROTOCOLS: true,
} satisfies DomPurifyTypes.Config);

export function sanitizeHtml(untrusted: string, config?: DomSanitizerConfig): TrustedHTML {
	return doSanitizeHtml(untrusted, config, 'trusted');
}

function doSanitizeHtml(untrusted: string, config: DomSanitizerConfig | undefined, outputType: 'dom'): DocumentFragment;
function doSanitizeHtml(untrusted: string, config: DomSanitizerConfig | undefined, outputType: 'trusted'): TrustedHTML;
function doSanitizeHtml(untrusted: string, config: DomSanitizerConfig | undefined, outputType: 'dom' | 'trusted'): TrustedHTML | DocumentFragment {
	try {
		const resolvedConfig: DomPurifyTypes.Config = { ...defaultDomPurifyConfig };

		if (config?.allowedTags) {
			if (config.allowedTags.override) {
				resolvedConfig.ALLOWED_TAGS = [...config.allowedTags.override];
			}

			if (config.allowedTags.augment) {
				resolvedConfig.ALLOWED_TAGS = [...(resolvedConfig.ALLOWED_TAGS ?? []), ...config.allowedTags.augment];
			}
		}

		let resolvedAttributes: Array<string | SanitizeAttributeRule> = [...defaultAllowedAttrs];
		if (config?.allowedAttributes) {
			if (config.allowedAttributes.override) {
				resolvedAttributes = [...config.allowedAttributes.override];
			}

			if (config.allowedAttributes.augment) {
				resolvedAttributes = [...resolvedAttributes, ...config.allowedAttributes.augment];
			}
		}

		resolvedAttributes = resolvedAttributes.map((attr): string | SanitizeAttributeRule => {
			if (typeof attr === 'string') {
				return attr.toLowerCase();
			}
			return {
				attributeName: attr.attributeName.toLowerCase(),
				shouldKeep: attr.shouldKeep,
			};
		});

		const allowedAttrNames = new Set(resolvedAttributes.map(attr => typeof attr === 'string' ? attr : attr.attributeName));
		const allowedAttrPredicates = new Map<string, SanitizeAttributeRule>();
		for (const attr of resolvedAttributes) {
			if (typeof attr === 'string') {
				allowedAttrPredicates.delete(attr);
			} else {
				allowedAttrPredicates.set(attr.attributeName, attr);
			}
		}

		resolvedConfig.ALLOWED_ATTR = Array.from(allowedAttrNames);

		hookDomPurifyHrefAndSrcSanitizer(
			{
				override: config?.allowedLinkProtocols?.override ?? [Schemas.http, Schemas.https],
				allowRelativePaths: config?.allowRelativeLinkPaths ?? false
			},
			{
				override: config?.allowedMediaProtocols?.override ?? [Schemas.http, Schemas.https],
				allowRelativePaths: config?.allowRelativeMediaPaths ?? false
			});

		if (config?.replaceWithPlaintext) {
			dompurify.addHook('uponSanitizeElement', replaceWithPlainTextHook);
		}

		if (allowedAttrPredicates.size) {
			dompurify.addHook('uponSanitizeAttribute', (node, e) => {
				const predicate = allowedAttrPredicates.get(e.attrName);
				if (predicate) {
					const result = predicate.shouldKeep(node, e);
					if (typeof result === 'string') {
						e.keepAttr = true;
						e.attrValue = result;
					} else {
						e.keepAttr = result;
					}
				} else {
					e.keepAttr = allowedAttrNames.has(e.attrName);
				}
			});
		}

		if (outputType === 'dom') {
			return dompurify.sanitize(untrusted, {
				...resolvedConfig,
				RETURN_DOM_FRAGMENT: true
			});
		} else {
			return dompurify.sanitize(untrusted, {
				...resolvedConfig,
				RETURN_TRUSTED_TYPE: true
			}) as unknown as TrustedHTML; // Cast from lib TrustedHTML to global TrustedHTML
		}
	} finally {
		dompurify.removeAllHooks();
	}
}

const selfClosingTags = ['area', 'base', 'br', 'col', 'command', 'embed', 'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr'];

const replaceWithPlainTextHook: DomPurifyTypes.UponSanitizeElementHook = (node, data, _config) => {
	if (!data.allowedTags[data.tagName] && data.tagName !== 'body') {
		const replacement = convertTagToPlaintext(node);
		if (replacement) {
			if (node.nodeType === Node.COMMENT_NODE) {
				node.parentElement?.insertBefore(replacement, node);
			} else {
				node.parentElement?.replaceChild(replacement, node);
			}
		}
	}
};

export function convertTagToPlaintext(node: Node): DocumentFragment | undefined {
	if (!node.ownerDocument) {
		return;
	}

	let startTagText: string;
	let endTagText: string | undefined;
	if (node.nodeType === Node.COMMENT_NODE) {
		startTagText = `<!--${node.textContent}-->`;
	} else if (node instanceof Element) {
		const tagName = node.tagName.toLowerCase();
		const isSelfClosing = selfClosingTags.includes(tagName);
		const attrString = node.attributes.length ?
			' ' + Array.from(node.attributes)
				.map(attr => `${attr.name}="${attr.value}"`)
				.join(' ')
			: '';
		startTagText = `<${tagName}${attrString}>`;
		if (!isSelfClosing) {
			endTagText = `</${tagName}>`;
		}
	} else {
		return;
	}

	const fragment = document.createDocumentFragment();
	const textNode = node.ownerDocument.createTextNode(startTagText);
	fragment.appendChild(textNode);
	while (node.firstChild) {
		fragment.appendChild(node.firstChild);
	}

	const endTagTextNode = endTagText ? node.ownerDocument.createTextNode(endTagText) : undefined;
	if (endTagTextNode) {
		fragment.appendChild(endTagTextNode);
	}

	return fragment;
}

export function safeSetInnerHtml(node: HTMLElement, untrusted: string, config?: DomSanitizerConfig): void {
	const fragment = doSanitizeHtml(untrusted, config, 'dom');
	reset(node, fragment);
}

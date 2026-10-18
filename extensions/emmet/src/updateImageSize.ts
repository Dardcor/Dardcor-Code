/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { TextEditor, Position, window, TextEdit } from 'vscode';
import * as path from 'path';
import { getImageSize, ImageInfoWithScale } from './imageSizeHelper';
import { getFlatNode, iterateCSSToken, getCssPropertyFromRule, isStyleSheet, validate, offsetRangeToVsRange } from './util';
import { HtmlNode, CssToken, HtmlToken, Attribute, Property } from 'EmmetFlatNode';
import { locateFile } from './locateFile';
import parseStylesheet from '@emmetio/css-parser';
import { getRootNode } from './parseDocument';

export function updateImageSize(): Promise<boolean> | undefined {
	if (!validate() || !window.activeTextEditor) {
		return;
	}
	const editor = window.activeTextEditor;

	const allUpdatesPromise = Array.from(editor.selections).reverse().map(selection => {
		const position = selection.isReversed ? selection.active : selection.anchor;
		if (!isStyleSheet(editor.document.languageId)) {
			return updateImageSizeHTML(editor, position);
		} else {
			return updateImageSizeCSSFile(editor, position);
		}
	});

	return Promise.all(allUpdatesPromise).then((updates) => {
		return editor.edit(builder => {
			updates.forEach(update => {
				update.forEach((textEdit: TextEdit) => {
					builder.replace(textEdit.range, textEdit.newText);
				});
			});
		});
	});
}

function updateImageSizeHTML(editor: TextEditor, position: Position): Promise<TextEdit[]> {
	const imageNode = getImageHTMLNode(editor, position);

	const src = imageNode && getImageSrcHTML(imageNode);

	if (!src) {
		return updateImageSizeStyleTag(editor, position);
	}

	return locateFile(path.dirname(editor.document.fileName), src)
		.then(getImageSize)
		.then((size: any) => {
			const img = getImageHTMLNode(editor, position);
			if (img && getImageSrcHTML(img) === src) {
				return updateHTMLTag(editor, img, size.width, size.height);
			}
			return [];
		})
		.catch(err => { console.warn('Error while updating image size:', err); return []; });
}

function updateImageSizeStyleTag(editor: TextEditor, position: Position): Promise<TextEdit[]> {
	const getPropertyInsiderStyleTag = (editor: TextEditor): Property | null => {
		const document = editor.document;
		const rootNode = getRootNode(document, true);
		const offset = document.offsetAt(position);
		const currentNode = <HtmlNode>getFlatNode(rootNode, offset, true);
		if (currentNode && currentNode.name === 'style'
			&& currentNode.open && currentNode.close
			&& currentNode.open.end < offset
			&& currentNode.close.start > offset) {
			const buffer = ' '.repeat(currentNode.open.end) +
				document.getText().substring(currentNode.open.end, currentNode.close.start);
			const innerRootNode = parseStylesheet(buffer);
			const innerNode = getFlatNode(innerRootNode, offset, true);
			return (innerNode && innerNode.type === 'property') ? <Property>innerNode : null;
		}
		return null;
	};

	return updateImageSizeCSS(editor, position, getPropertyInsiderStyleTag);
}

function updateImageSizeCSSFile(editor: TextEditor, position: Position): Promise<TextEdit[]> {
	return updateImageSizeCSS(editor, position, getImageCSSNode);
}

function updateImageSizeCSS(editor: TextEditor, position: Position, fetchNode: (editor: TextEditor, position: Position) => Property | null): Promise<TextEdit[]> {
	const node = fetchNode(editor, position);
	const src = node && getImageSrcCSS(editor, node, position);

	if (!src) {
		return Promise.reject(new Error('No valid image source'));
	}

	return locateFile(path.dirname(editor.document.fileName), src)
		.then(getImageSize)
		.then((size: ImageInfoWithScale | undefined): TextEdit[] => {
			const prop = fetchNode(editor, position);
			if (size && prop && getImageSrcCSS(editor, prop, position) === src) {
				return updateCSSNode(editor, prop, size.width, size.height);
			}
			return [];
		})
		.catch(err => { console.warn('Error while updating image size:', err); return []; });
}

function getImageHTMLNode(editor: TextEditor, position: Position): HtmlNode | null {
	const document = editor.document;
	const rootNode = getRootNode(document, true);
	const offset = document.offsetAt(position);
	const node = <HtmlNode>getFlatNode(rootNode, offset, true);

	return node && node.name.toLowerCase() === 'img' ? node : null;
}

function getImageCSSNode(editor: TextEditor, position: Position): Property | null {
	const document = editor.document;
	const rootNode = getRootNode(document, true);
	const offset = document.offsetAt(position);
	const node = getFlatNode(rootNode, offset, true);
	return node && node.type === 'property' ? <Property>node : null;
}

function getImageSrcHTML(node: HtmlNode): string | undefined {
	const srcAttr = getAttribute(node, 'src');
	if (!srcAttr) {
		return;
	}

	return (<HtmlToken>srcAttr.value).value;
}

function getImageSrcCSS(editor: TextEditor, node: Property | undefined, position: Position): string | undefined {
	if (!node) {
		return;
	}
	const urlToken = findUrlToken(editor, node, position);
	if (!urlToken) {
		return;
	}

	let urlValue = urlToken.item(0);
	if (urlValue && urlValue.type === 'string') {
		urlValue = urlValue.item(0);
	}

	return urlValue && urlValue.valueOf();
}

function updateHTMLTag(editor: TextEditor, node: HtmlNode, width: number, height: number): TextEdit[] {
	const document = editor.document;
	const srcAttr = getAttribute(node, 'src');
	if (!srcAttr) {
		return [];
	}

	const widthAttr = getAttribute(node, 'width');
	const heightAttr = getAttribute(node, 'height');
	const quote = getAttributeQuote(editor, srcAttr);
	const endOfAttributes = node.attributes[node.attributes.length - 1].end;

	const edits: TextEdit[] = [];
	let textToAdd = '';

	if (!widthAttr) {
		textToAdd += ` width=${quote}${width}${quote}`;
	} else {
		edits.push(new TextEdit(offsetRangeToVsRange(document, widthAttr.value.start, widthAttr.value.end), String(width)));
	}
	if (!heightAttr) {
		textToAdd += ` height=${quote}${height}${quote}`;
	} else {
		edits.push(new TextEdit(offsetRangeToVsRange(document, heightAttr.value.start, heightAttr.value.end), String(height)));
	}
	if (textToAdd) {
		edits.push(new TextEdit(offsetRangeToVsRange(document, endOfAttributes, endOfAttributes), textToAdd));
	}

	return edits;
}

function updateCSSNode(editor: TextEditor, srcProp: Property, width: number, height: number): TextEdit[] {
	const document = editor.document;
	const rule = srcProp.parent;
	const widthProp = getCssPropertyFromRule(rule, 'width');
	const heightProp = getCssPropertyFromRule(rule, 'height');

	const separator = srcProp.separator || ': ';
	const before = getPropertyDelimitor(editor, srcProp);

	const edits: TextEdit[] = [];
	if (!srcProp.terminatorToken) {
		edits.push(new TextEdit(offsetRangeToVsRange(document, srcProp.end, srcProp.end), ';'));
	}

	let textToAdd = '';
	if (!widthProp) {
		textToAdd += `${before}width${separator}${width}px;`;
	} else {
		edits.push(new TextEdit(offsetRangeToVsRange(document, widthProp.valueToken.start, widthProp.valueToken.end), `${width}px`));
	}
	if (!heightProp) {
		textToAdd += `${before}height${separator}${height}px;`;
	} else {
		edits.push(new TextEdit(offsetRangeToVsRange(document, heightProp.valueToken.start, heightProp.valueToken.end), `${height}px`));
	}
	if (textToAdd) {
		edits.push(new TextEdit(offsetRangeToVsRange(document, srcProp.end, srcProp.end), textToAdd));
	}

	return edits;
}

function getAttribute(node: HtmlNode, attrName: string): Attribute | undefined {
	attrName = attrName.toLowerCase();
	return node && node.attributes.find(attr => attr.name.toString().toLowerCase() === attrName);
}

function getAttributeQuote(editor: TextEditor, attr: Attribute): string {
	const begin = attr.value ? attr.value.end : attr.end;
	const end = attr.end;
	return begin === end ? '' : editor.document.getText().substring(begin, end);
}

function findUrlToken(editor: TextEditor, node: Property, pos: Position): CssToken | undefined {
	const offset = editor.document.offsetAt(pos);
	if (!('parsedValue' in node) || !Array.isArray(node.parsedValue)) {
		return undefined;
	}

	for (let i = 0, il = node.parsedValue.length, url; i < il; i++) {
		iterateCSSToken(node.parsedValue[i], (token: CssToken) => {
			if (token.type === 'url' && token.start <= offset && token.end >= offset) {
				url = token;
				return false;
			}
			return true;
		});

		if (url) {
			return url;
		}
	}
	return undefined;
}

function getPropertyDelimitor(editor: TextEditor, node: Property): string {
	let anchor;
	if (anchor = (node.previousSibling || node.parent.contentStartToken)) {
		return editor.document.getText().substring(anchor.end, node.start);
	} else if (anchor = (node.nextSibling || node.parent.contentEndToken)) {
		return editor.document.getText().substring(node.end, anchor.start);
	}

	return '';
}


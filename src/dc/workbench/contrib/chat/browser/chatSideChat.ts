/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { IChatSideChatSelection } from '../common/chatSideChatService.js';
import { IChatWidget } from './chat.js';

export function captureSideChatSelection(widget: IChatWidget | undefined): IChatSideChatSelection | undefined {
	if (!widget) {
		return undefined;
	}
	const nativeSelection = dom.getActiveWindow().getSelection();
	const selectedText = nativeSelection?.toString();
	if (!nativeSelection || !selectedText || !selectedText.trim()) {
		return undefined;
	}
	const { anchorNode, focusNode } = nativeSelection;
	if (!anchorNode || !focusNode || !dom.isAncestor(anchorNode, widget.domNode) || !dom.isAncestor(focusNode, widget.domNode)) {
		return undefined;
	}
	const inputEditorDomNode = widget.inputEditor.getDomNode();
	if (inputEditorDomNode && (dom.isAncestor(anchorNode, inputEditorDomNode) || dom.isAncestor(focusNode, inputEditorDomNode))) {
		return undefined;
	}
	return { text: selectedText };
}

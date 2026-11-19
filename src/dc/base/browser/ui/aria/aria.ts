/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../dom.js';
import './aria.css';

const MAX_MESSAGE_LENGTH = 20000;
let ariaContainer: HTMLElement;
let alertContainer: HTMLElement;
let alertContainer2: HTMLElement;
let statusContainer: HTMLElement;
let statusContainer2: HTMLElement;
export function setARIAContainer(parent: HTMLElement) {
	ariaContainer = document.createElement('div');
	ariaContainer.className = 'monaco-aria-container';

	const createAlertContainer = () => {
		const element = document.createElement('div');
		element.className = 'monaco-alert';
		element.setAttribute('role', 'alert');
		element.setAttribute('aria-atomic', 'true');
		ariaContainer.appendChild(element);
		return element;
	};
	alertContainer = createAlertContainer();
	alertContainer2 = createAlertContainer();

	const createStatusContainer = () => {
		const element = document.createElement('div');
		element.className = 'monaco-status';
		element.setAttribute('aria-live', 'polite');
		element.setAttribute('aria-atomic', 'true');
		ariaContainer.appendChild(element);
		return element;
	};
	statusContainer = createStatusContainer();
	statusContainer2 = createStatusContainer();

	parent.appendChild(ariaContainer);
}
export function alert(msg: string): void {
	if (!ariaContainer) {
		return;
	}

	if (alertContainer.textContent !== msg) {
		dom.clearNode(alertContainer2);
		insertMessage(alertContainer, msg);
	} else {
		dom.clearNode(alertContainer);
		insertMessage(alertContainer2, msg);
	}
}

export function status(msg: string): void {
	if (!ariaContainer) {
		return;
	}

	if (statusContainer.textContent !== msg) {
		dom.clearNode(statusContainer2);
		insertMessage(statusContainer, msg);
	} else {
		dom.clearNode(statusContainer);
		insertMessage(statusContainer2, msg);
	}
}

function insertMessage(target: HTMLElement, msg: string): void {
	dom.clearNode(target);
	if (msg.length > MAX_MESSAGE_LENGTH) {
		msg = msg.substr(0, MAX_MESSAGE_LENGTH);
	}
	target.textContent = msg;

	target.style.visibility = 'hidden';
	target.style.visibility = 'visible';
}

export type AriaRole =
	| 'alert'
	| 'alertdialog'
	| 'application'
	| 'article'
	| 'banner'
	| 'button'
	| 'cell'
	| 'checkbox'
	| 'columnheader'
	| 'combobox'
	| 'complementary'
	| 'contentinfo'
	| 'definition'
	| 'dialog'
	| 'directory'
	| 'document'
	| 'feed'
	| 'figure'
	| 'form'
	| 'grid'
	| 'gridcell'
	| 'group'
	| 'heading'
	| 'img'
	| 'link'
	| 'list'
	| 'listbox'
	| 'listitem'
	| 'log'
	| 'main'
	| 'marquee'
	| 'math'
	| 'menu'
	| 'menubar'
	| 'menuitem'
	| 'menuitemcheckbox'
	| 'menuitemradio'
	| 'navigation'
	| 'none'
	| 'note'
	| 'option'
	| 'presentation'
	| 'progressbar'
	| 'radio'
	| 'radiogroup'
	| 'region'
	| 'row'
	| 'rowgroup'
	| 'rowheader'
	| 'scrollbar'
	| 'search'
	| 'searchbox'
	| 'separator'
	| 'slider'
	| 'spinbutton'
	| 'status'
	| 'switch'
	| 'tab'
	| 'table'
	| 'tablist'
	| 'tabpanel'
	| 'term'
	| 'textbox'
	| 'timer'
	| 'toolbar'
	| 'tooltip'
	| 'tree'
	| 'treegrid'
	| 'treeitem'
	| (string & {})
	;

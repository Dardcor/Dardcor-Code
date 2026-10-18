/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { DomScrollableElement } from '../../../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { Lazy } from '../../../../../../base/common/lazy.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';

import { ScrollbarVisibility } from '../../../../../../base/common/scrollable.js';

export function wrapTablesWithScrollable(domNode: HTMLElement, layoutParticipants: Lazy<Set<() => void>>): DisposableStore {
	const store = new DisposableStore();
	// eslint-disable-next-line no-restricted-syntax
	for (const table of domNode.querySelectorAll('table')) {
		if (!dom.isHTMLElement(table)) {
			continue;
		}

		applyTableColumnMinWidths(table);

		const parent = table.parentElement;
		const nextSibling = table.nextSibling;
		const tableContainer = document.createElement('div');
		tableContainer.appendChild(table);
		const scrollable = store.add(new DomScrollableElement(tableContainer, {
			vertical: ScrollbarVisibility.Hidden,
			horizontal: ScrollbarVisibility.Auto,
		}));
		const scrollNode = scrollable.getDomNode();
		scrollNode.classList.add('rendered-markdown-table-scroll-wrapper');
		parent?.insertBefore(scrollNode, nextSibling);

		layoutParticipants.value.add(() => { scrollable.scanDomNode(); });
		scrollable.scanDomNode();
	}
	return store;
}

const TABLE_COLUMN_MIN_WIDTH_CAP_CH = 3;

function applyTableColumnMinWidths(table: HTMLTableElement): void {
	const rows = table.rows;
	const colMaxChars: number[] = [];
	for (const row of rows) {
		for (let c = 0; c < row.cells.length; c++) {
			const len = row.cells[c].textContent?.length ?? 0;
			if (len > (colMaxChars[c] ?? 0)) {
				colMaxChars[c] = len;
			}
		}
	}
	const firstRow = rows[0];
	if (firstRow) {
		for (let c = 0; c < firstRow.cells.length; c++) {
			const minCh = colMaxChars[c];
			if (minCh !== undefined && minCh > 1) {
				firstRow.cells[c].style.minWidth = Math.min(minCh, TABLE_COLUMN_MIN_WIDTH_CAP_CH) + 'ch';
			}
		}
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SettingsManager } from './settings';

const codeLineClass = 'code-line';


export class CodeLineElement {
	readonly #detailParentElements: readonly HTMLDetailsElement[];

	constructor(
		readonly element: HTMLElement,
		readonly line: number,
		readonly codeElement?: HTMLElement,
		readonly endLine?: number,
	) {
		this.#detailParentElements = Array.from(getParentsWithTagName<HTMLDetailsElement>(element, 'DETAILS'));
	}

	get isVisible(): boolean {
		if (this.#detailParentElements.some(x => !x.open)) {
			return false;
		}

		const style = window.getComputedStyle(this.element);
		if (style.display === 'none' || style.visibility === 'hidden') {
			return false;
		}

		const bounds = this.element.getBoundingClientRect();
		if (bounds.height === 0 || bounds.width === 0) {
			return false;
		}

		return true;
	}
}

const getCodeLineElements = (() => {
	let cachedElements: CodeLineElement[] | undefined;
	let cachedVersion = -1;
	return (documentVersion: number) => {
		if (!cachedElements || documentVersion !== cachedVersion) {
			cachedVersion = documentVersion;
			cachedElements = [new CodeLineElement(document.body, -1)];
			for (const element of document.getElementsByClassName(codeLineClass)) {
				if (!(element instanceof HTMLElement)) {
					continue;
				}

				const line = +element.getAttribute('data-line')!;
				if (isNaN(line)) {
					continue;
				}

				if (element.tagName === 'CODE' && element.parentElement && element.parentElement.tagName === 'PRE') {
					const text = element.textContent || '';
					const lineCount = (text.match(/\n/g) || []).length + 1;
					const endLine = line + lineCount - 1;
					cachedElements.push(new CodeLineElement(element.parentElement, line, element, endLine));
				} else if (element.tagName === 'PRE') {
				} else if (element.tagName === 'UL' || element.tagName === 'OL') {
				} else {
					cachedElements.push(new CodeLineElement(element, line));
				}
			}
		}
		return cachedElements;
	};
})();

export function getElementsForSourceLine(targetLine: number, documentVersion: number): { previous: CodeLineElement; next?: CodeLineElement } {
	const lineNumber = Math.floor(targetLine);
	const lines = getCodeLineElements(documentVersion);
	let previous = lines[0] || null;
	for (const entry of lines) {
		if (entry.line === lineNumber) {
			return { previous: entry, next: undefined };
		} else if (entry.line > lineNumber) {
			return { previous, next: entry };
		}
		previous = entry;
	}
	return { previous };
}

export function getElementsForSourceLineRange(startLine: number, endLine: number, documentVersion: number): readonly CodeLineElement[] {
	const rangeStart = Math.floor(startLine);
	const rangeEnd = Math.max(rangeStart + 1, Math.ceil(endLine));
	const lines = getCodeLineElements(documentVersion).filter(element => element.line >= 0);
	const elements: CodeLineElement[] = [];
	for (let i = 0; i < lines.length; i++) {
		const element = lines[i];
		const next = lines[i + 1];
		const elementStart = element.line;
		const elementEnd = element.endLine !== undefined
			? element.endLine + 1
			: (next && next.line > element.line ? next.line : element.line + 1);
		if (rangesIntersect(rangeStart, rangeEnd, elementStart, elementEnd)) {
			elements.push(element);
		}
	}
	return elements;
}

function rangesIntersect(startA: number, endA: number, startB: number, endB: number): boolean {
	return startA < endB && startB < endA;
}

export function getLineElementsAtPageOffset(offset: number, documentVersion: number): { previous: CodeLineElement; next?: CodeLineElement } {
	const lines = getCodeLineElements(documentVersion).filter(x => x.isVisible);
	const position = offset - window.scrollY;
	let lo = -1;
	let hi = lines.length - 1;
	while (lo + 1 < hi) {
		const mid = Math.floor((lo + hi) / 2);
		const bounds = getElementBounds(lines[mid]);
		if (bounds.top + bounds.height >= position) {
			hi = mid;
		}
		else {
			lo = mid;
		}
	}
	const hiElement = lines[hi];
	const hiBounds = getElementBounds(hiElement);

	if (hi >= 1 && hiBounds.top > position) {
		const loElement = lines[lo];
		return { previous: loElement, next: hiElement };
	}
	if (hi > 1 && hi < lines.length && hiBounds.top + hiBounds.height > position) {
		return { previous: hiElement, next: lines[hi + 1] };
	}
	return { previous: hiElement };
}

function getElementBounds(codeLineElement: CodeLineElement): { top: number; height: number } {
	const { element, codeElement } = codeLineElement;
	const myBounds = element.getBoundingClientRect();

	if (codeElement) {
		return myBounds;
	}

	const codeLineChild = element.querySelector(`.${codeLineClass}`);
	if (codeLineChild) {
		const childBounds = codeLineChild.getBoundingClientRect();
		const height = Math.max(1, (childBounds.top - myBounds.top));
		return {
			top: myBounds.top,
			height: height
		};
	}

	return myBounds;
}

function getContentBounds(codeLineElement: CodeLineElement): {
	top: number;
	height: number;
	paddingTop: number;
	paddingBottom: number;
} {
	const { element, codeElement } = codeLineElement;
	const bounds = getElementBounds(codeLineElement);

	if (codeElement) {
		const computedStyle = window.getComputedStyle(element);
		const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
		const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;

		return {
			top: bounds.top + paddingTop,
			height: bounds.height - paddingTop - paddingBottom,
			paddingTop,
			paddingBottom
		};
	}

	return {
		top: bounds.top,
		height: bounds.height,
		paddingTop: 0,
		paddingBottom: 0
	};
}

export function scrollToRevealSourceLine(line: number, documentVersion: number, settingsManager: SettingsManager) {
	if (!settingsManager.settings?.scrollPreviewWithEditor) {
		return;
	}

	if (line <= 0) {
		window.scroll(window.scrollX, 0);
		return;
	}

	const { previous, next } = getElementsForSourceLine(line, documentVersion);
	if (!previous) {
		return;
	}
	let scrollTo = 0;
	const rect = getElementBounds(previous);
	const previousTop = rect.top;


	if (previous.endLine && previous.endLine > previous.line) {
		if (line < previous.endLine) {
			const contentBounds = getContentBounds(previous);
			const progressInCodeBlock = (line - previous.line) / (previous.endLine - previous.line);


			const contentAbsoluteTop = window.scrollY + contentBounds.top;
			const targetAbsoluteY = contentAbsoluteTop + (contentBounds.height * progressInCodeBlock);
			scrollTo = targetAbsoluteY;

		} else if (next && next.line !== previous.line) {
			const betweenProgress = (line - previous.endLine) / (next.line - previous.endLine);
			const elementAbsoluteEnd = window.scrollY + previousTop + rect.height;
			const nextAbsoluteTop = window.scrollY + next.element.getBoundingClientRect().top;
			const betweenHeight = nextAbsoluteTop - elementAbsoluteEnd;
			scrollTo = elementAbsoluteEnd + betweenProgress * betweenHeight;
		} else {
			scrollTo = window.scrollY + previousTop + rect.height;
		}
	} else if (next && next.line !== previous.line) {
		const betweenProgress = (line - previous.line) / (next.line - previous.line);
		const elementAbsoluteEnd = window.scrollY + previousTop + rect.height;
		const nextAbsoluteTop = window.scrollY + next.element.getBoundingClientRect().top;
		const betweenHeight = nextAbsoluteTop - elementAbsoluteEnd;
		scrollTo = elementAbsoluteEnd + betweenProgress * betweenHeight;
	} else {
		const progressInElement = line - Math.floor(line);
		scrollTo = window.scrollY + previousTop + (rect.height * progressInElement);
	}

	window.scroll(window.scrollX, Math.max(1, scrollTo));
}

export function getEditorLineNumberForPageOffset(offset: number, documentVersion: number): number | null {
	const { previous, next } = getLineElementsAtPageOffset(offset, documentVersion);
	if (previous) {
		if (previous.line < 0) {
			return 0;
		}
		const previousBounds = getElementBounds(previous);
		const offsetFromPrevious = (offset - window.scrollY - previousBounds.top);


		if (previous.endLine && previous.endLine > previous.line) {
			const contentBounds = getContentBounds(previous);
			const offsetFromContent = offset - window.scrollY - contentBounds.top;


			if (offsetFromContent >= 0 && offsetFromContent <= contentBounds.height) {
				const progressWithinCodeBlock = offsetFromContent / contentBounds.height;
				const calculatedLine = previous.line + progressWithinCodeBlock * (previous.endLine - previous.line);
				return calculatedLine;
			} else if (next && offsetFromContent > contentBounds.height) {
				const gapOffset = offsetFromContent - contentBounds.height;
				const nextBounds = getElementBounds(next);
				const contentEnd = contentBounds.top + contentBounds.height;
				const gapHeight = nextBounds.top - contentEnd;
				const progressInGap = gapOffset / gapHeight;
				const calculatedLine = previous.endLine + progressInGap * (next.line - previous.endLine);
				return calculatedLine;
			} else if (offsetFromContent < 0) {
			}
		}

		if (next) {
			const progressBetweenElements = offsetFromPrevious / (getElementBounds(next).top - previousBounds.top);
			const calculatedLine = previous.line + progressBetweenElements * (next.line - previous.line);
			return calculatedLine;
		} else {
			const progressWithinElement = offsetFromPrevious / (previousBounds.height);
			const calculatedLine = previous.line + progressWithinElement;
			return calculatedLine;
		}
	}
	return null;
}

export function getLineElementForFragment(fragment: string, documentVersion: number): CodeLineElement | undefined {
	return getCodeLineElements(documentVersion).find((element) => {
		return element.element.id === fragment;
	});
}

function* getParentsWithTagName<T extends HTMLElement>(element: HTMLElement, tagName: string): Iterable<T> {
	for (let parent = element.parentElement; parent; parent = parent.parentElement) {
		if (parent.tagName === tagName) {
			yield parent as T;
		}
	}
}

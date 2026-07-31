/**
 * Dardcor Code - Viewport Visible Line Calculator (Task 210)
 * Mirrors: vs/editor/common/viewModel/viewport.ts
 */

export interface IViewportData {
	readonly startLineNumber: number;
	readonly endLineNumber: number;
	readonly visibleLineCount: number;
}

export class Viewport {
	static compute(
		scrollTop: number,
		viewportHeight: number,
		lineHeight: number,
		totalLineCount: number
	): IViewportData {
		const startLineNumber = Math.max(1, Math.floor(scrollTop / lineHeight) + 1);
		const visibleCount = Math.ceil(viewportHeight / lineHeight) + 1;
		const endLineNumber = Math.min(totalLineCount, startLineNumber + visibleCount - 1);

		return {
			startLineNumber,
			endLineNumber,
			visibleLineCount: Math.max(0, endLineNumber - startLineNumber + 1),
		};
	}
}

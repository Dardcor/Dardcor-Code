/**
 * Dardcor Code - Hover Card Viewport Collision Position Calculator
 */

export interface IHoverAnchor {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface IHoverViewport {
	readonly width: number;
	readonly height: number;
}

export interface IHoverNodeSize {
	readonly width: number;
	readonly height: number;
}

export interface IHoverPosition {
	readonly left: number;
	readonly top: number;
	readonly placement: "below" | "above";
	readonly fits: boolean;
}

export interface IHoverPositionOptions {
	readonly margin: number;
	readonly preferPlacement: "below" | "above";
	readonly maxWidth: number;
}

const DEFAULT_OPTIONS: IHoverPositionOptions = {
	margin: 4,
	preferPlacement: "below",
	maxWidth: 520
};

/**
 * Pure collision calculation for a tooltip/hover card. Given the anchor
 * rectangle (cursor coordinates), the viewport of the container and the
 * measured size of the hover node it computes a position that stays inside
 * the viewport, flipping vertically when there is not enough room below.
 */
export class HoverPositionCalculator {
	constructor(private readonly _options: IHoverPositionOptions = { ...DEFAULT_OPTIONS }) {}

	public static compute(anchor: IHoverAnchor, viewport: IHoverViewport, nodeSize: IHoverNodeSize, options?: Partial<IHoverPositionOptions>): IHoverPosition {
		return new HoverPositionCalculator({ ...DEFAULT_OPTIONS, ...options }).compute(anchor, viewport, nodeSize);
	}

	public compute(anchor: IHoverAnchor, viewport: IHoverViewport, nodeSize: IHoverNodeSize): IHoverPosition {
		const opts = this._options;
		const width = Math.min(nodeSize.width, Math.max(opts.maxWidth, 80));
		const height = Math.min(nodeSize.height, viewport.height - opts.margin * 2);

		const belowTop = anchor.y + anchor.height + opts.margin;
		const aboveTop = anchor.y - height - opts.margin;

		const spaceBelow = viewport.height - belowTop;
		const spaceAbove = aboveTop;
		const prefersBelow = opts.preferPlacement === "below";

		let placement: "below" | "above";
		let top: number;
		if (spaceBelow >= height) {
			placement = "below";
			top = belowTop;
		} else if (spaceAbove >= height) {
			placement = "above";
			top = Math.max(0, aboveTop);
		} else if (prefersBelow) {
			placement = "below";
			top = Math.max(0, Math.min(belowTop, viewport.height - height - opts.margin));
		} else {
			placement = "above";
			top = Math.max(0, aboveTop);
		}

		let left = anchor.x;
		if (left + width > viewport.width - opts.margin) {
			left = Math.max(0, viewport.width - width - opts.margin);
		}

		const fits = left + width <= viewport.width - opts.margin && top + height <= viewport.height - opts.margin;
		return { left: Math.round(left), top: Math.round(top), placement, fits };
	}
}

/**
 * Locates the hover node inside the viewport before measurement so the
 * calculator can be fed with real dimensions (display:none elements have 0
 * size).
 */
export function measureHoverNode(node: HTMLElement, viewport: IHoverViewport): IHoverNodeSize {
	if (!node.parentElement) {
		return { width: 0, height: 0 };
	}
	const prevDisplay = node.style.display;
	const prevVisibility = node.style.visibility;
	node.style.display = "block";
	node.style.visibility = "hidden";
	const rect = node.getBoundingClientRect();
	node.style.display = prevDisplay;
	node.style.visibility = prevVisibility;
	return {
		width: Math.min(rect.width || 0, viewport.width),
		height: Math.min(rect.height || 0, viewport.height)
	};
}

export function shouldFlipVertically(position: IHoverPosition, availableBelow: number, availableAbove: number): boolean {
	if (position.placement === "below") {
		return availableBelow < 40 && availableAbove >= availableBelow;
	}
	return availableAbove < 40 && availableBelow >= availableAbove;
}

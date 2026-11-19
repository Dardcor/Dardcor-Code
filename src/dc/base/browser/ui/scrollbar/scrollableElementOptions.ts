/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ScrollbarVisibility } from '../../../common/scrollable.js';

export interface ScrollableElementCreationOptions {
	lazyRender?: boolean;
	className?: string;
	useShadows?: boolean;
	handleMouseWheel?: boolean;
	mouseWheelSmoothScroll?: boolean;
	inertialScroll?: boolean;
	flipAxes?: boolean;
	scrollYToX?: boolean;
	consumeMouseWheelIfScrollbarIsNeeded?: boolean;
	alwaysConsumeMouseWheel?: boolean;
	mouseWheelScrollSensitivity?: number;
	fastScrollSensitivity?: number;
	scrollPredominantAxis?: boolean;
	arrowSize?: number;
	listenOnDomNode?: HTMLElement;
	horizontal?: ScrollbarVisibility;
	horizontalScrollbarSize?: number;
	horizontalSliderSize?: number;
	horizontalHasArrows?: boolean;
	vertical?: ScrollbarVisibility;
	verticalScrollbarSize?: number;
	verticalSliderSize?: number;
	verticalHasArrows?: boolean;
	scrollByPage?: boolean;
}

export interface ScrollableElementChangeOptions {
	handleMouseWheel?: boolean;
	mouseWheelScrollSensitivity?: number;
	fastScrollSensitivity?: number;
	scrollPredominantAxis?: boolean;
	horizontal?: ScrollbarVisibility;
	horizontalScrollbarSize?: number;
	vertical?: ScrollbarVisibility;
	verticalScrollbarSize?: number;
	scrollByPage?: boolean;
}

export interface ScrollableElementResolvedOptions {
	lazyRender: boolean;
	className: string;
	useShadows: boolean;
	handleMouseWheel: boolean;
	flipAxes: boolean;
	scrollYToX: boolean;
	consumeMouseWheelIfScrollbarIsNeeded: boolean;
	alwaysConsumeMouseWheel: boolean;
	mouseWheelScrollSensitivity: number;
	fastScrollSensitivity: number;
	scrollPredominantAxis: boolean;
	mouseWheelSmoothScroll: boolean;
	inertialScroll: boolean;
	arrowSize: number;
	listenOnDomNode: HTMLElement | null;
	horizontal: ScrollbarVisibility;
	horizontalScrollbarSize: number;
	horizontalSliderSize: number;
	horizontalHasArrows: boolean;
	vertical: ScrollbarVisibility;
	verticalScrollbarSize: number;
	verticalSliderSize: number;
	verticalHasArrows: boolean;
	scrollByPage: boolean;
}

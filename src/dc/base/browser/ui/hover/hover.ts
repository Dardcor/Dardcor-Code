/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IHoverDelegate } from './hoverDelegate.js';
import type { HoverPosition } from './hoverWidget.js';
import type { CancellationToken } from '../../../common/cancellation.js';
import type { IMarkdownString } from '../../../common/htmlContent.js';
import type { AnchorAlignment } from '../../../common/layout.js';
import type { IDisposable } from '../../../common/lifecycle.js';

export interface IHoverDelegate2 {
	showDelayedHover(
		options: IHoverOptions,
		lifecycleOptions: Pick<IHoverLifecycleOptions, 'groupId'>,
	): IHoverWidget | undefined;

	setupDelayedHover(
		target: HTMLElement,
		hoverOptions: (() => IDelayedHoverOptions) | IDelayedHoverOptions,
		lifecycleOptions?: IHoverLifecycleOptions,
	): IDisposable;

	setupDelayedHoverAtMouse(
		target: HTMLElement,
		hoverOptions: (() => IDelayedHoverAtMouseOptions) | IDelayedHoverAtMouseOptions,
		lifecycleOptions?: IHoverLifecycleOptions,
	): IDisposable;

	showInstantHover(
		options: IHoverOptions,
		focus?: boolean
	): IHoverWidget | undefined;

	hideHover(force?: boolean): void;

	showAndFocusLastHover(): void;

	setupManagedHover(hoverDelegate: IHoverDelegate, targetElement: HTMLElement, content: IManagedHoverContentOrFactory, options?: IManagedHoverOptions): IManagedHover;

	showManagedHover(targetElement: HTMLElement): void;
}

export interface IHoverWidget extends IDisposable {
	readonly isDisposed: boolean;
}

export const enum HoverStyle {
	Pointer = 1,
	Mouse = 2,
}

export interface IHoverOptions {
	content: IMarkdownString | string | HTMLElement;

	target: IHoverTarget | HTMLElement;

	container?: HTMLElement;

	id?: string;

	actions?: IHoverAction[];

	additionalClasses?: string[];

	linkHandler?(url: string): void;

	trapFocus?: boolean;

	style?: HoverStyle;

	position?: IHoverPositionOptions;

	persistence?: IHoverPersistenceOptions;

	appearance?: IHoverAppearanceOptions;

	onDidShow?(): void;

	onDidHide?(): void;
}

export type IDelayedHoverOptions = Omit<IHoverOptions, 'target'>;

export type IDelayedHoverAtMouseOptions = Omit<IDelayedHoverOptions, 'position' | 'appearance'> & { appearance?: Omit<IHoverAppearanceOptions, 'showPointer'> };

export interface IHoverLifecycleOptions {
	groupId?: string;

	reducedDelay?: boolean;

	setupKeyboardEvents?: boolean;
}

export interface IHoverPositionOptions {
	hoverPosition?: HoverPosition | MouseEvent;

	anchorAlignment?: AnchorAlignment;

	forcePosition?: boolean;
}

export interface IHoverPersistenceOptions {
	hideOnHover?: boolean;

	hideOnKeyDown?: boolean;

	sticky?: boolean;
}

export interface IHoverAppearanceOptions {
	showPointer?: boolean;

	compact?: boolean;

	showHoverHint?: boolean;

	skipFadeInAnimation?: boolean;

	maxHeightRatio?: number;
}

export interface IHoverAction {
	label: string;

	commandId: string;

	iconClass?: string;

	run(target: HTMLElement): void;
}

export interface IHoverTarget extends Partial<IDisposable> {
	readonly targetElements: readonly HTMLElement[];

	readonly x?: number;

	readonly y?: number;
}


export interface IManagedHoverTooltipMarkdownString {
	markdown: IMarkdownString | string | undefined | ((token: CancellationToken) => Promise<IMarkdownString | string | undefined>);
	markdownNotSupportedFallback: string | undefined;
}

export function isManagedHoverTooltipMarkdownString(obj: unknown): obj is IManagedHoverTooltipMarkdownString {
	const candidate = obj as IManagedHoverTooltipMarkdownString;
	return typeof candidate === 'object' && 'markdown' in candidate && 'markdownNotSupportedFallback' in candidate;
}

export interface IManagedHoverTooltipHTMLElement {
	element: (token: CancellationToken) => HTMLElement | Promise<HTMLElement>;
}

export function isManagedHoverTooltipHTMLElement(obj: unknown): obj is IManagedHoverTooltipHTMLElement {
	const candidate = obj as IManagedHoverTooltipHTMLElement;
	return typeof candidate === 'object' && 'element' in candidate;
}

export type IManagedHoverContent = string | IManagedHoverTooltipMarkdownString | IManagedHoverTooltipHTMLElement | HTMLElement | undefined;
export type IManagedHoverContentOrFactory = IManagedHoverContent | (() => IManagedHoverContent);

export interface IManagedHoverOptions extends Pick<IHoverOptions, 'actions' | 'linkHandler' | 'trapFocus'> {
	appearance?: Pick<IHoverAppearanceOptions, 'showHoverHint'>;
	position?: Pick<IHoverPositionOptions, 'anchorAlignment'>;
}

export interface IManagedHover extends IDisposable {
	show(focus?: boolean): void;

	hide(): void;

	update(tooltip: IManagedHoverContent, options?: IManagedHoverOptions): void;
}


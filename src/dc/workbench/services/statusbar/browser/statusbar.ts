/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeColor } from '../../../../base/common/themables.js';
import { Command } from '../../../../editor/common/languages.js';
import { IMarkdownString } from '../../../../base/common/htmlContent.js';
import { IManagedHoverTooltipHTMLElement, IManagedHoverTooltipMarkdownString } from '../../../../base/browser/ui/hover/hover.js';
import { ColorIdentifier } from '../../../../platform/theme/common/colorRegistry.js';
import { IAuxiliaryStatusbarPart, IStatusbarEntryContainer } from '../../../browser/parts/statusbar/statusbarPart.js';

export const IStatusbarService = createDecorator<IStatusbarService>('statusbarService');

export interface IStatusbarService extends IStatusbarEntryContainer {

	readonly _serviceBrand: undefined;

	getPart(container: HTMLElement): IStatusbarEntryContainer;

	createAuxiliaryStatusbarPart(container: HTMLElement, instantiationService: IInstantiationService): IAuxiliaryStatusbarPart;

	createScoped(statusbarEntryContainer: IStatusbarEntryContainer, disposables: DisposableStore): IStatusbarService;
}

export const enum StatusbarAlignment {
	LEFT,
	RIGHT
}

export interface IStatusbarEntryLocation {

	location: {
		id: string;
		priority: number;
	};

	alignment: StatusbarAlignment;

	compact?: boolean;
}

export function isStatusbarEntryLocation(thing: unknown): thing is IStatusbarEntryLocation {
	const candidate = thing as IStatusbarEntryLocation | undefined;

	return typeof candidate?.location?.id === 'string' && typeof candidate.alignment === 'number';
}

export interface IStatusbarEntryPriority {

	readonly primary: number | IStatusbarEntryLocation;

	readonly secondary: number;
}

export function isStatusbarEntryPriority(thing: unknown): thing is IStatusbarEntryPriority {
	const candidate = thing as IStatusbarEntryPriority | undefined;

	return (typeof candidate?.primary === 'number' || isStatusbarEntryLocation(candidate?.primary)) && typeof candidate?.secondary === 'number';
}

export const ShowTooltipCommand: Command = {
	id: 'statusBar.entry.showTooltip',
	title: ''
};

export interface IStatusbarStyleOverride {
	readonly priority: number;
	readonly foreground?: ColorIdentifier;
	readonly background?: ColorIdentifier;
	readonly border?: ColorIdentifier;
}

export type StatusbarEntryKind = 'standard' | 'warning' | 'error' | 'prominent' | 'remote' | 'offline';
export const StatusbarEntryKinds: StatusbarEntryKind[] = ['standard', 'warning', 'error', 'prominent', 'remote', 'offline'];

export type TooltipContent = string | IMarkdownString | HTMLElement | IManagedHoverTooltipMarkdownString | IManagedHoverTooltipHTMLElement;

export interface ITooltipWithCommands {
	readonly content: TooltipContent;
	readonly commands: Command[];
}

export function isTooltipWithCommands(thing: unknown): thing is ITooltipWithCommands {
	const candidate = thing as ITooltipWithCommands | undefined;

	return !!candidate?.content && Array.isArray(candidate?.commands);
}

export interface IStatusbarEntry {

	readonly name: string;

	readonly text: string;

	readonly ariaLabel: string;

	readonly role?: string;

	readonly tooltip?: TooltipContent | ITooltipWithCommands;

	readonly color?: string | ThemeColor;

	readonly backgroundColor?: string | ThemeColor;

	readonly command?: string | Command | typeof ShowTooltipCommand;

	readonly showBeak?: boolean;

	readonly showProgress?: boolean | 'loading' | 'syncing';

	readonly kind?: StatusbarEntryKind;

	readonly showInAllWindows?: boolean;

	readonly extensionId?: string;

	readonly content?: HTMLElement;
}

export interface IStatusbarEntryAccessor extends IDisposable {

	update(properties: IStatusbarEntry): void;
}

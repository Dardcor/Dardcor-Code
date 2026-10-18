/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IQuickAccessController } from './quickAccess.js';
import { IMatch } from '../../../base/common/filters.js';
import { IItemAccessor } from '../../../base/common/fuzzyScorer.js';
import { ResolvedKeybinding } from '../../../base/common/keybindings.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { Schemas } from '../../../base/common/network.js';
import { IObservable } from '../../../base/common/observable.js';
import Severity from '../../../base/common/severity.js';
import { URI } from '../../../base/common/uri.js';
import { IMarkdownString } from '../../../base/common/htmlContent.js';

export interface IQuickItemHighlights {
	label?: IMatch[];
	description?: IMatch[];
}

export interface IQuickPickItemHighlights extends IQuickItemHighlights {
	detail?: IMatch[];
}

export type QuickPickItem = IQuickPickSeparator | IQuickPickItem;

export interface IQuickItem {
	id?: string;
	label: string;
	ariaLabel?: string;
	description?: string;
	italic?: boolean;
	strikethrough?: boolean;
	iconClasses?: readonly string[];
	iconPath?: { dark: URI; light?: URI };
	iconClass?: string;
	highlights?: IQuickItemHighlights;
	buttons?: readonly IQuickInputButton[];
	disabled?: boolean;
}

export interface IQuickPickItem extends IQuickItem {
	type?: 'item';
	detail?: string;
	tooltip?: string | IMarkdownString;
	highlights?: IQuickPickItemHighlights;
	keybinding?: ResolvedKeybinding;
	picked?: boolean;
	alwaysShow?: boolean;
	pickable?: boolean;
}

export interface IQuickPickSeparator {
	type: 'separator';
	id?: string;
	label?: string;
	description?: string;
	ariaLabel?: string;
	buttons?: readonly IQuickInputButton[];
	tooltip?: string | IMarkdownString;
}

export interface IKeyMods {
	readonly ctrlCmd: boolean;
	readonly alt: boolean;
	readonly shift: boolean;
}

export function isKeyModified(keyMods: IKeyMods): boolean {
	return keyMods.ctrlCmd || keyMods.alt || keyMods.shift;
}

export const NO_KEY_MODS: IKeyMods = { ctrlCmd: false, alt: false, shift: false };

export interface IQuickNavigateConfiguration {
	keybindings: readonly ResolvedKeybinding[];
}

export interface IPickOptions<T extends IQuickPickItem> {

	title?: string;

	value?: string;

	placeHolder?: string;

	prompt?: string;

	matchOnDescription?: boolean;

	matchOnDetail?: boolean;

	matchOnLabel?: boolean;

	sortByLabel?: boolean;

	ignoreFocusLost?: boolean;

	canPickMany?: boolean;

	quickNavigate?: IQuickNavigateConfiguration;

	hideInput?: boolean;

	contextKey?: string;

	activeItem?: Promise<T> | T;

	anchor?: unknown | { x: number; y: number };

	anchorPosition?: 'above' | 'overlay';

	onKeyMods?: (keyMods: IKeyMods) => void;
	onDidFocus?: (entry: T) => void;
	onDidTriggerItemButton?: (context: IQuickPickItemButtonContext<T>) => void;
	onDidTriggerSeparatorButton?: (context: IQuickPickSeparatorButtonEvent) => void;
}

export interface IInputOptions {

	title?: string;

	value?: string;

	valueSelection?: readonly [number, number];

	prompt?: string;

	placeHolder?: string;

	password?: boolean;

	ignoreFocusLost?: boolean;

	validateInput?: (input: string) => Promise<string | null | undefined | { content: string; severity: Severity }>;
}

export enum QuickInputHideReason {

	Blur = 1,

	Gesture,

	Other
}

export interface IQuickInputHideEvent {
	reason: QuickInputHideReason;
}

export const enum QuickInputType {
	QuickPick = 'quickPick',
	InputBox = 'inputBox',
	QuickWidget = 'quickWidget',
	QuickTree = 'quickTree'
}

export interface IQuickInput extends IDisposable {

	readonly type: QuickInputType;

	readonly onDidHide: Event<IQuickInputHideEvent>;

	readonly onWillHide: Event<IQuickInputHideEvent>;

	readonly onDispose: Event<void>;

	title: string | undefined;

	description: string | undefined;

	step: number | undefined;

	totalSteps: number | undefined;

	buttons: ReadonlyArray<IQuickInputButton>;

	readonly onDidTriggerButton: Event<IQuickInputButton>;

	enabled: boolean;

	contextKey: string | undefined;

	busy: boolean;

	ignoreFocusOut: boolean;

	anchor?: unknown | { x: number; y: number };

	anchorPosition?: 'above' | 'overlay';

	widgetPosition?: 'default' | 'center';

	show(): void;

	hide(): void;

	didHide(reason?: QuickInputHideReason): void;

	willHide(reason?: QuickInputHideReason): void;
}

export interface IQuickWidget extends IQuickInput {

	readonly type: QuickInputType.QuickWidget;

	widget: unknown | undefined;
}

export interface IQuickPickWillAcceptEvent {

	veto(): void;
}

export interface IQuickPickDidAcceptEvent {

	inBackground: boolean;
}

export enum ItemActivation {
	NONE,
	FIRST,
	SECOND,
	LAST
}

export enum QuickPickFocus {
	First = 1,
	Second,
	Last,
	Next,
	Previous,
	NextPage,
	PreviousPage,
	NextSeparator,
	PreviousSeparator
}

export interface IQuickPick<T extends IQuickPickItem, O extends { useSeparators: boolean } = { useSeparators: false }> extends IQuickInput {

	readonly type: QuickInputType.QuickPick;

	value: string;

	filterValue: (value: string) => string;

	ariaLabel: string | undefined;

	placeholder: string | undefined;

	prompt: string | undefined;

	readonly onDidChangeValue: Event<string>;

	readonly onWillAccept: Event<IQuickPickWillAcceptEvent>;

	readonly onDidAccept: Event<IQuickPickDidAcceptEvent>;

	canAcceptInBackground: boolean;

	ok: boolean | 'default';

	okLabel: string | undefined;

	readonly onDidCustom: Event<void>;

	customButton: boolean;

	customLabel: string | undefined;

	customHover: string | undefined;

	customButtonSecondary?: boolean;

	readonly onDidTriggerItemButton: Event<IQuickPickItemButtonEvent<T>>;

	readonly onDidTriggerSeparatorButton: Event<IQuickPickSeparatorButtonEvent>;

	items: O extends { useSeparators: true } ? ReadonlyArray<T | IQuickPickSeparator> : ReadonlyArray<T>;

	canSelectMany: boolean;

	matchOnDescription: boolean;

	matchOnDetail: boolean;

	matchOnLabel: boolean;

	matchOnLabelMode: 'fuzzy' | 'contiguous';

	sortByLabel: boolean;

	keepScrollPosition: boolean;

	quickNavigate: IQuickNavigateConfiguration | undefined;

	activeItems: ReadonlyArray<T>;

	readonly onDidChangeActive: Event<T[]>;

	itemActivation: ItemActivation;

	selectedItems: ReadonlyArray<T>;

	readonly onDidChangeSelection: Event<T[]>;

	readonly keyMods: IKeyMods;

	valueSelection: Readonly<[number, number]> | undefined;

	validationMessage: string | undefined;

	severity: Severity;

	inputHasFocus(): boolean;

	focusOnInput(): void;

	hideInput: boolean;

	hideCountBadge: boolean;

	hideCheckAll: boolean;

	focus(focus: QuickPickFocus): void;

	accept(inBackground?: boolean): void;
}

export interface IInputBox extends IQuickInput {

	readonly type: QuickInputType.InputBox;

	value: string;

	valueSelection: Readonly<[number, number]> | undefined;

	placeholder: string | undefined;

	password: boolean;

	readonly onDidChangeValue: Event<string>;

	readonly onDidAccept: Event<void>;

	prompt: string | undefined;

	validationMessage: string | undefined;

	severity: Severity;

	accept(): void;
}

export enum QuickInputButtonLocation {
	Title = 1,

	Inline = 2,

	Input = 3,
}

export interface IQuickInputButton {
	iconPath?: { dark: URI; light?: URI };
	iconClass?: string;
	tooltip?: string;
	alwaysVisible?: boolean;
	location?: QuickInputButtonLocation;
	readonly toggle?: { checked: boolean };
	label?: string;
	secondary?: boolean;
}

export interface IQuickInputButtonWithToggle extends IQuickInputButton {
	readonly toggle: { checked: boolean };
}

export interface IQuickPickItemButtonEvent<T extends IQuickPickItem> {
	button: IQuickInputButton;
	item: T;
}

export interface IQuickPickSeparatorButtonEvent {
	button: IQuickInputButton;
	separator: IQuickPickSeparator;
}

export interface IQuickPickItemButtonContext<T extends IQuickPickItem> extends IQuickPickItemButtonEvent<T> {
	removeItem(): void;
}

export type QuickPickInput<T = IQuickPickItem> = T | IQuickPickSeparator;



export type IQuickPickItemWithResource = IQuickPickItem & { resource?: URI };

export class QuickPickItemScorerAccessor implements IItemAccessor<IQuickPickItemWithResource> {

	constructor(private options?: { skipDescription?: boolean; skipPath?: boolean }) { }

	getItemLabel(entry: IQuickPickItemWithResource): string {
		return entry.label;
	}

	getItemDescription(entry: IQuickPickItemWithResource): string | undefined {
		if (this.options?.skipDescription) {
			return undefined;
		}

		return entry.description;
	}

	getItemPath(entry: IQuickPickItemWithResource): string | undefined {
		if (this.options?.skipPath) {
			return undefined;
		}

		if (entry.resource?.scheme === Schemas.file) {
			return entry.resource.fsPath;
		}

		return entry.resource?.path;
	}
}

export const quickPickItemScorerAccessor = new QuickPickItemScorerAccessor();


export const IQuickInputService = createDecorator<IQuickInputService>('quickInputService');

export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;

export type QuickInputAlignment = 'top' | 'center' | 'custom';

export interface IQuickInputService {

	readonly _serviceBrand: undefined;

	readonly backButton: IQuickInputButton;

	readonly quickAccess: IQuickAccessController;

	readonly onShow: Event<void>;

	readonly onHide: Event<void>;

	readonly alignment: IObservable<QuickInputAlignment>;

	pick<T extends IQuickPickItem>(picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], options?: IPickOptions<T> & { canPickMany: true }, token?: CancellationToken): Promise<T[] | undefined>;
	pick<T extends IQuickPickItem>(picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], options?: IPickOptions<T> & { canPickMany: false }, token?: CancellationToken): Promise<T | undefined>;
	pick<T extends IQuickPickItem>(picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], options?: Omit<IPickOptions<T>, 'canPickMany'>, token?: CancellationToken): Promise<T | undefined>;

	input(options?: IInputOptions, token?: CancellationToken): Promise<string | undefined>;

	createQuickPick<T extends IQuickPickItem>(options: { useSeparators: true }): IQuickPick<T, { useSeparators: true }>;
	createQuickPick<T extends IQuickPickItem>(options?: { useSeparators: boolean }): IQuickPick<T, { useSeparators: false }>;

	createInputBox(): IInputBox;

	createQuickWidget(): IQuickWidget;

	createQuickTree<T extends IQuickTreeItem>(): IQuickTree<T>;

	focus(): void;

	toggle(): void;

	navigate(next: boolean, quickNavigate?: IQuickNavigateConfiguration): void;

	back(): Promise<void>;

	accept(keyMods?: IKeyMods): Promise<void>;

	cancel(reason?: QuickInputHideReason): Promise<void>;

	toggleHover(): void;

	currentQuickInput: IQuickInput | undefined;

	setAlignment(alignment: 'top' | 'center' | { top: number; left: number }): void;
}


export interface IQuickTree<T extends IQuickTreeItem> extends IQuickInput {

	readonly type: QuickInputType.QuickTree;

	value: string;

	ariaLabel: string | undefined;

	placeholder: string | undefined;

	readonly onDidChangeValue: Event<string>;

	readonly onDidAccept: Event<void>;

	matchOnDescription: boolean;

	matchOnLabel: boolean;

	sortByLabel: boolean;

	activeItems: ReadonlyArray<T>;

	validationMessage: string | undefined;

	severity: Severity;

	readonly itemTree: ReadonlyArray<Readonly<T>>;

	readonly checkedLeafItems: ReadonlyArray<T>;

	getParent(element: T): T | undefined;

	readonly onDidChangeActive: Event<ReadonlyArray<T>>;

	readonly onDidChangeCheckedLeafItems: Event<ReadonlyArray<T>>;

	readonly onDidChangeCheckboxState: Event<T>;

	readonly onDidTriggerItemButton: Event<IQuickTreeItemButtonEvent<T>>;

	setItemTree(itemTree: T[]): void;

	expand(element: T): void;

	collapse(element: T): void;

	isCollapsed(element: T): boolean;

	focusOnInput(): void;

	reveal(element: T): void;

	focus(focus: QuickPickFocus): void;

	accept(inBackground?: boolean): void;
}

export interface IQuickTreeItem extends IQuickItem {
	checked?: boolean | 'mixed';

	collapsed?: boolean;

	children?: readonly IQuickTreeItem[];

	pickable?: boolean;
}

export interface IQuickTreeCheckboxEvent<T extends IQuickTreeItem> {
	item: T;

	checked: boolean | 'mixed';
}

export interface IQuickTreeItemButtonEvent<T extends IQuickTreeItem> {
	button: IQuickInputButton;
	item: T;
}


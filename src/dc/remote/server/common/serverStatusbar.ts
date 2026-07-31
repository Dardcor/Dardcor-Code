import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export function createDecorator<T>(serviceId: string): any {
	return serviceId;
}

export interface IInstantiationService {
	createInstance<T>(ctor: any, ...args: any[]): T;
}

export interface ThemeColor {
	readonly id: string;
}

export interface Command {
	readonly id: string;
	readonly title: string;
}

export interface IMarkdownString {
	readonly value: string;
}

export interface IManagedHoverTooltipHTMLElement {
	element: HTMLElement;
}

export interface IManagedHoverTooltipMarkdownString {
	markdown: IMarkdownString;
}

export type ColorIdentifier = string;

export class DisposableStore implements IDisposable {
	private readonly _toDispose = new Set<IDisposable>();
	dispose(): void {
		for (const item of this._toDispose) { item.dispose(); }
		this._toDispose.clear();
	}
	add<T extends IDisposable>(item: T): T {
		this._toDispose.add(item);
		return item;
	}
}

export const IServerStatusbarService = createDecorator<IServerStatusbarService>('serverStatusbarService');

export interface IServerStatusbarService extends IServerStatusbarEntryContainer {
	readonly _serviceBrand: undefined;
	getPart(container: HTMLElement): IServerStatusbarEntryContainer;
	createAuxiliaryStatusbarPart(container: HTMLElement, instantiationService: IInstantiationService): IAuxiliaryServerStatusbarPart;
	createScoped(statusbarEntryContainer: IServerStatusbarEntryContainer, disposables: DisposableStore): IServerStatusbarService;
}

export const enum ServerStatusbarAlignment {
	LEFT,
	RIGHT
}

export interface IServerStatusbarEntryLocation {
	location: {
		id: string;
		priority: number;
	};
	alignment: ServerStatusbarAlignment;
	compact?: boolean;
}

export function isServerStatusbarEntryLocation(thing: unknown): thing is IServerStatusbarEntryLocation {
	const candidate = thing as IServerStatusbarEntryLocation | undefined;
	return typeof candidate?.location?.id === 'string' && typeof candidate.alignment === 'number';
}

export interface IServerStatusbarEntryPriority {
	readonly primary: number | IServerStatusbarEntryLocation;
	readonly secondary: number;
}

export function isServerStatusbarEntryPriority(thing: unknown): thing is IServerStatusbarEntryPriority {
	const candidate = thing as IServerStatusbarEntryPriority | undefined;
	return (typeof candidate?.primary === 'number' || isServerStatusbarEntryLocation(candidate?.primary)) && typeof candidate?.secondary === 'number';
}

export const ShowServerTooltipCommand: Command = {
	id: 'statusBar.entry.showTooltip',
	title: ''
};

export interface IServerStatusbarStyleOverride {
	readonly priority: number;
	readonly foreground?: ColorIdentifier;
	readonly background?: ColorIdentifier;
	readonly border?: ColorIdentifier;
}

export type ServerStatusbarEntryKind = 'standard' | 'warning' | 'error' | 'prominent' | 'remote' | 'offline';
export const ServerStatusbarEntryKinds: ServerStatusbarEntryKind[] = ['standard', 'warning', 'error', 'prominent', 'remote', 'offline'];

export type ServerTooltipContent = string | IMarkdownString | HTMLElement | IManagedHoverTooltipMarkdownString | IManagedHoverTooltipHTMLElement;

export interface IServerTooltipWithCommands {
	readonly content: ServerTooltipContent;
	readonly commands: Command[];
}

export function isServerTooltipWithCommands(thing: unknown): thing is IServerTooltipWithCommands {
	const candidate = thing as IServerTooltipWithCommands | undefined;
	return !!candidate?.content && Array.isArray(candidate?.commands);
}

export interface IServerStatusbarEntry {
	readonly name: string;
	readonly text: string;
	readonly ariaLabel: string;
	readonly role?: string;
	readonly tooltip?: ServerTooltipContent | IServerTooltipWithCommands;
	readonly color?: string | ThemeColor;
	readonly backgroundColor?: string | ThemeColor;
	readonly command?: string | Command | typeof ShowServerTooltipCommand;
	readonly showBeak?: boolean;
	readonly showProgress?: boolean | 'loading' | 'syncing';
	readonly kind?: ServerStatusbarEntryKind;
	readonly showInAllWindows?: boolean;
	readonly extensionId?: string;
	readonly content?: HTMLElement;
}

export interface IServerStatusbarEntryAccessor extends IDisposable {
	update(properties: IServerStatusbarEntry): void;
}

export interface IServerStatusbarEntryContainer {
	addEntry(entry: IServerStatusbarEntry, id: string, priority: IServerStatusbarEntryPriority, alignment: ServerStatusbarAlignment): IServerStatusbarEntryAccessor;
	isEntryVisible(id: string): boolean;
	updateEntryVisibility(id: string, visible: boolean): void;
	focus(preserveEntryFocus?: boolean): void;
	focusNextEntry(): void;
	focusPreviousEntry(): void;
	isEntryFocused(): boolean;
	overrideStyle(style: IServerStatusbarStyleOverride): IDisposable;
}

export interface IAuxiliaryServerStatusbarPart extends IServerStatusbarEntryContainer {
	readonly container: HTMLElement;
	readonly height: number;
}

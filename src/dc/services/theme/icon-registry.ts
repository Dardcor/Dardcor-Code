/**
 * Dardcor Code - SVG & Font Icon Set Manager (Task 130)
 */

import { createDecorator } from '../instantiation/annotations.js';
import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';

export const ICON_FONT_ID = 'dc-icon-font';

export interface IIconDefinition {
	readonly codepoint?: string;
	readonly svg?: string;
	readonly fontId?: string;
	readonly unicode?: string;
}

export interface IIconRegistration {
	readonly id: string;
	readonly definition: IIconDefinition;
	readonly description?: string;
}

export interface IIconRegistry {
	readonly _serviceBrand: undefined;
	registerIcon(id: string, definition: IIconDefinition, description?: string): IDisposable;
	getIcon(id: string): IIconRegistration | undefined;
	getCodepoint(id: string): string | undefined;
	getUnicode(id: string): string | undefined;
	getSVG(id: string): string | undefined;
	hasIcon(id: string): boolean;
	getRegisteredIconIds(): string[];
	renderIcon(id: string, className?: string): string;
}

export const IIconRegistry = createDecorator<IIconRegistry>('iconRegistry');

export class IconRegistry extends Disposable implements IIconRegistry {
	declare readonly _serviceBrand: undefined;

	private readonly _icons = new Map<string, IIconRegistration>();

	public registerIcon(id: string, definition: IIconDefinition, description?: string): IDisposable {
		this._icons.set(id, { id, definition, description });
		return toDisposable(() => this._icons.delete(id));
	}

	public getIcon(id: string): IIconRegistration | undefined {
		return this._icons.get(id);
	}

	public getCodepoint(id: string): string | undefined {
		return this._icons.get(id)?.definition.codepoint;
	}

	public getUnicode(id: string): string | undefined {
		const icon = this._icons.get(id);
		if (!icon) {
			return undefined;
		}
		return icon.definition.unicode ?? icon.definition.codepoint;
	}

	public getSVG(id: string): string | undefined {
		return this._icons.get(id)?.definition.svg;
	}

	public hasIcon(id: string): boolean {
		return this._icons.has(id);
	}

	public getRegisteredIconIds(): string[] {
		return [...this._icons.keys()];
	}

	public renderIcon(id: string, className: string = 'dc-icon'): string {
		const icon = this._icons.get(id);
		if (!icon) {
			return '';
		}
		if (icon.definition.svg) {
			return `<span class="${className}" data-icon-id="${id}">${icon.definition.svg}</span>`;
		}
		const glyph = icon.definition.unicode ?? icon.definition.codepoint ?? '';
		return `<span class="${className}" data-icon-id="${id}">${glyph}</span>`;
	}
}

let _globalRegistry: IconRegistry | null = null;

export function getIconRegistry(): IconRegistry {
	if (!_globalRegistry) {
		_globalRegistry = new IconRegistry();
		registerDefaultIcons(_globalRegistry);
	}
	return _globalRegistry;
}

export function registerIcon(id: string, definition: IIconDefinition, description?: string): IDisposable {
	return getIconRegistry().registerIcon(id, definition, description);
}

export namespace IconIds {
	export const close = 'close';
	export const chevronDown = 'chevron-down';
	export const chevronUp = 'chevron-up';
	export const chevronRight = 'chevron-right';
	export const chevronLeft = 'chevron-left';
	export const folder = 'folder';
	export const folderOpen = 'folder-open';
	export const file = 'file';
	export const search = 'search';
	export const add = 'add';
	export const remove = 'remove';
	export const ellipsis = 'ellipsis';
	export const gear = 'gear';
	export const refresh = 'refresh';
	export const check = 'check';
	export const copy = 'copy';
	export const error = 'error';
	export const warning = 'warning';
	export const info = 'info';
	export const run = 'run';
	export const debug = 'debug';
	export const terminal = 'terminal';
	export const sourceControl = 'source-control';
	export const extensions = 'extensions';
	export const settings = 'settings';
	export const home = 'home';
	export const star = 'star';
	export const trash = 'trash';
	export const history = 'history';
	export const splitHorizontal = 'split-horizontal';
	export const splitVertical = 'split-vertical';
}

function registerDefaultIcons(registry: IconRegistry): void {
	const icons: Array<[string, IIconDefinition]> = [
		[IconIds.close, { unicode: '×' }],
		[IconIds.chevronDown, { unicode: '▾' }],
		[IconIds.chevronUp, { unicode: '▴' }],
		[IconIds.chevronRight, { unicode: '▸' }],
		[IconIds.chevronLeft, { unicode: '◂' }],
		[IconIds.folder, { unicode: '▸', codepoint: '\\ea69' }],
		[IconIds.folderOpen, { unicode: '▾', codepoint: '\\ea6a' }],
		[IconIds.file, { unicode: '•', codepoint: '\\ea6b' }],
		[IconIds.search, { unicode: '⌕', codepoint: '\\ea71' }],
		[IconIds.add, { unicode: '+', codepoint: '\\ea60' }],
		[IconIds.remove, { unicode: '−', codepoint: '\\ea76' }],
		[IconIds.ellipsis, { unicode: '⋯' }],
		[IconIds.gear, { unicode: '⚙', codepoint: '\\ea93' }],
		[IconIds.refresh, { unicode: '↻', codepoint: '\\eb09' }],
		[IconIds.check, { unicode: '✓', codepoint: '\\eab2' }],
		[IconIds.copy, { unicode: '⧉', codepoint: '\\ebcc' }],
		[IconIds.error, { unicode: '✕', codepoint: '\\ea87' }],
		[IconIds.warning, { unicode: '⚠', codepoint: '\\ea6c' }],
		[IconIds.info, { unicode: 'ⓘ', codepoint: '\\ea74' }],
		[IconIds.run, { unicode: '▶', codepoint: '\\eb29' }],
		[IconIds.debug, { unicode: '🐞', codepoint: '\\eb25' }],
		[IconIds.terminal, { unicode: '❯', codepoint: '\\ea78' }],
		[IconIds.sourceControl, { unicode: '⛃', codepoint: '\\ea68' }],
		[IconIds.extensions, { unicode: '⬡', codepoint: '\\ea97' }],
		[IconIds.settings, { unicode: '⚙', codepoint: '\\ea93' }],
		[IconIds.home, { unicode: '⌂', codepoint: '\\eae9' }],
		[IconIds.star, { unicode: '★', codepoint: '\\eab8' }],
		[IconIds.trash, { unicode: '✖', codepoint: '\\eb1b' }],
		[IconIds.history, { unicode: '↶', codepoint: '\\eb09' }],
		[IconIds.splitHorizontal, { unicode: '⬌' }],
		[IconIds.splitVertical, { unicode: '⬍' }]
	];
	for (const [id, definition] of icons) {
		registry.registerIcon(id, { ...definition, fontId: ICON_FONT_ID });
	}
}

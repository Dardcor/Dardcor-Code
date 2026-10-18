/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../base/common/codicons.js';
import { Color } from '../../../base/common/color.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { IEnvironmentService } from '../../environment/common/environment.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import * as platform from '../../registry/common/platform.js';
import { ColorIdentifier } from './colorRegistry.js';
import { IconContribution, IconDefinition } from './iconRegistry.js';
import { ColorScheme, ThemeTypeSelector } from './theme.js';

export const IThemeService = createDecorator<IThemeService>('themeService');

export function themeColorFromId(id: ColorIdentifier) {
	return { id };
}

export const FileThemeIcon = Codicon.file;
export const FolderThemeIcon = Codicon.folder;

export function getThemeTypeSelector(type: ColorScheme): ThemeTypeSelector {
	switch (type) {
		case ColorScheme.DARK: return ThemeTypeSelector.VS_DARK;
		case ColorScheme.HIGH_CONTRAST_DARK: return ThemeTypeSelector.HC_BLACK;
		case ColorScheme.HIGH_CONTRAST_LIGHT: return ThemeTypeSelector.HC_LIGHT;
		default: return ThemeTypeSelector.VS;
	}
}

export interface ITokenStyle {
	readonly foreground: number | undefined;
	readonly bold: boolean | undefined;
	readonly underline: boolean | undefined;
	readonly strikethrough: boolean | undefined;
	readonly italic: boolean | undefined;
}

export interface IColorTheme {

	readonly type: ColorScheme;

	readonly label: string;

	getColor(color: ColorIdentifier, useDefault?: boolean): Color | undefined;

	defines(color: ColorIdentifier): boolean;

	getTokenStyleMetadata(type: string, modifiers: string[], modelLanguage: string): ITokenStyle | undefined;

	readonly tokenColorMap: string[];

	readonly tokenFontMap: IFontTokenOptions[];

	readonly semanticHighlighting: boolean;
}

export class IFontTokenOptions {
	fontFamily?: string;
	fontSizeMultiplier?: number;
	lineHeightMultiplier?: number;
}

export interface IFileIconTheme {
	readonly hasFileIcons: boolean;
	readonly hasFolderIcons: boolean;
	readonly hidesExplorerArrows: boolean;
}

export interface IProductIconTheme {
	getIcon(iconContribution: IconContribution): IconDefinition | undefined;
}


export interface ICssStyleCollector {
	addRule(rule: string): void;
}

export interface IThemingParticipant {
	(theme: IColorTheme, collector: ICssStyleCollector, environment: IEnvironmentService): void;
}

export interface IThemeService {
	readonly _serviceBrand: undefined;

	getColorTheme(): IColorTheme;

	readonly onDidColorThemeChange: Event<IColorTheme>;

	getFileIconTheme(): IFileIconTheme;

	readonly onDidFileIconThemeChange: Event<IFileIconTheme>;

	getProductIconTheme(): IProductIconTheme;

	readonly onDidProductIconThemeChange: Event<IProductIconTheme>;

}

export const Extensions = {
	ThemingContribution: 'base.contributions.theming'
};

export interface IThemingRegistry {

	onColorThemeChange(participant: IThemingParticipant): IDisposable;

	getThemingParticipants(): IThemingParticipant[];

	readonly onThemingParticipantAdded: Event<IThemingParticipant>;
}

class ThemingRegistry extends Disposable implements IThemingRegistry {
	private themingParticipants: IThemingParticipant[] = [];
	private readonly onThemingParticipantAddedEmitter: Emitter<IThemingParticipant>;

	constructor() {
		super();
		this.themingParticipants = [];
		this.onThemingParticipantAddedEmitter = this._register(new Emitter<IThemingParticipant>());
	}

	public onColorThemeChange(participant: IThemingParticipant): IDisposable {
		this.themingParticipants.push(participant);
		this.onThemingParticipantAddedEmitter.fire(participant);
		return toDisposable(() => {
			const idx = this.themingParticipants.indexOf(participant);
			this.themingParticipants.splice(idx, 1);
		});
	}

	public get onThemingParticipantAdded(): Event<IThemingParticipant> {
		return this.onThemingParticipantAddedEmitter.event;
	}

	public getThemingParticipants(): IThemingParticipant[] {
		return this.themingParticipants;
	}
}

const themingRegistry = new ThemingRegistry();
platform.Registry.add(Extensions.ThemingContribution, themingRegistry);

export function registerThemingParticipant(participant: IThemingParticipant): IDisposable {
	return themingRegistry.onColorThemeChange(participant);
}

export class Themable extends Disposable {
	protected theme: IColorTheme;

	constructor(
		protected themeService: IThemeService
	) {
		super();

		this.theme = themeService.getColorTheme();

		this._register(this.themeService.onDidColorThemeChange(theme => this.onThemeChange(theme)));
	}

	protected onThemeChange(theme: IColorTheme): void {
		this.theme = theme;

		this.updateStyles();
	}

	updateStyles(): void {
	}

	protected getColor(id: string, modify?: (color: Color, theme: IColorTheme) => Color): string | null {
		let color = this.theme.getColor(id);

		if (color && modify) {
			color = modify(color, this.theme);
		}

		return color ? color.toString() : null;
	}
}

export interface IPartsSplash {
	zoomLevel: number | undefined;
	baseTheme: ThemeTypeSelector;
	colorInfo: {
		background: string;
		foreground: string | undefined;
		editorBackground: string | undefined;
		titleBarBackground: string | undefined;
		titleBarInactiveBackground?: string;
		titleBarBorder: string | undefined;
		activityBarBackground: string | undefined;
		activityBarBorder: string | undefined;
		modernActivityBarBackground: string | undefined;
		modernActivityBarInactiveBackground: string | undefined;
		modernActivityBarBorder: string | undefined;
		modernPanelBorder: string | undefined;
		modernUIShellBackground: string | undefined;
		modernUIInactiveShellBackground: string | undefined;
		sideBarBackground: string | undefined;
		sideBarBorder: string | undefined;
		panelBackground: string | undefined;
		editorGroupBorder: string | undefined;
		editorBorder: string | undefined;
		surfaceBackground: string | undefined;
		surfaceBorder: string | undefined;
		agentsPanelBackground: string | undefined;
		agentsPanelBorder: string | undefined;
		statusBarBackground: string | undefined;
		statusBarInactiveBackground: string | undefined;
		statusBarBorder: string | undefined;
		statusBarNoFolderBackground: string | undefined;
		windowBorder: string | undefined;
	};
	layoutInfo: {
		sideBarSide: string;
		editorPartMinWidth: number;
		titleBarHeight: number;
		activityBarWidth: number;
		sideBarWidth: number;
		auxiliaryBarWidth: number;
		statusBarHeight: number;
		windowBorder: boolean;
		windowBorderRadius: string | undefined;
		modernUI: boolean;
		modernUICompact: boolean;
		partBounds: {
			activityBar?: IPartsSplashPartBounds;
			sideBar: IPartsSplashPartBounds | undefined;
			auxiliaryBar: IPartsSplashPartBounds | undefined;
			panel: IPartsSplashPartBounds | undefined;
			editor: IPartsSplashPartBounds | undefined;
		} | undefined;
	} | undefined;
}

export interface IPartsSplashPartBounds {
	top: number;
	left: number;
	width: number;
	height: number;
	outerEdges?: {
		left: boolean;
		right: boolean;
		top: boolean;
		bottom: boolean;
	};
}

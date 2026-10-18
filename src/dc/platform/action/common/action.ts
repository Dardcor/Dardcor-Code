/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI, UriDto } from '../../../base/common/uri.js';
import { ContextKeyExpression } from '../../contextkey/common/contextkey.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { Categories } from './actionCommonCategories.js';
import { ICommandMetadata } from '../../commands/common/commands.js';

export interface ILocalizedString {

	value: string;

	original: string;
}

export function isLocalizedString(thing: unknown): thing is ILocalizedString {
	return !!thing
		&& typeof thing === 'object'
		&& typeof (thing as ILocalizedString).original === 'string'
		&& typeof (thing as ILocalizedString).value === 'string';
}

export interface ICommandActionTitle extends ILocalizedString {

	mnemonicTitle?: string;
}

export type Icon = { dark?: URI; light?: URI } | ThemeIcon;

export interface ICommandActionToggleInfo {

	condition: ContextKeyExpression;

	icon?: Icon;

	tooltip?: string;

	title?: string;

	mnemonicTitle?: string;
}

export function isICommandActionToggleInfo(thing: ContextKeyExpression | ICommandActionToggleInfo | undefined): thing is ICommandActionToggleInfo {
	return thing ? (<ICommandActionToggleInfo>thing).condition !== undefined : false;
}

export interface ICommandActionSource {
	readonly id: string;
	readonly title: string;
}

export interface ICommandAction {
	id: string;
	title: string | ICommandActionTitle;
	shortTitle?: string | ICommandActionTitle;
	metadata?: ICommandMetadata;
	category?: keyof typeof Categories | ILocalizedString | string;
	tooltip?: string | ILocalizedString;
	icon?: Icon;
	source?: ICommandActionSource;
	precondition?: ContextKeyExpression;

	toggled?: ContextKeyExpression | ICommandActionToggleInfo;
}

export type ISerializableCommandAction = UriDto<ICommandAction>;

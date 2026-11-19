/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IWorkspace, ISingleFolderWorkspaceIdentifier, IWorkspaceIdentifier } from '../../workspace/common/workspace.js';

export const ILabelService = createDecorator<ILabelService>('labelService');

export interface ILabelService {

	readonly _serviceBrand: undefined;

	getUriLabel(resource: URI, options?: { relative?: boolean; noPrefix?: boolean; separator?: '/' | '\\'; appendWorkspaceSuffix?: boolean }): string;
	getUriBasenameLabel(resource: URI): string;
	getWorkspaceLabel(workspace: (IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | URI | IWorkspace), options?: { verbose: Verbosity }): string;
	getHostLabel(scheme: string, authority?: string): string;
	getHostTooltip(scheme: string, authority?: string): string | undefined;
	getSeparator(scheme: string, authority?: string): '/' | '\\';

	registerFormatter(formatter: ResourceLabelFormatter | ResourceLabelTemplateFormatter): IDisposable;
	readonly onDidChangeFormatters: Event<IFormatterChangeEvent>;

	registerCachedFormatter(formatter: ResourceLabelFormatter | ResourceLabelTemplateFormatter): IDisposable;
}

export const enum Verbosity {
	SHORT,
	MEDIUM,
	LONG
}

export interface IFormatterChangeEvent {
	scheme: string;
}

export interface ResourceLabelFormatter {
	scheme: string;
	authority?: string;
	priority?: boolean;
	home?: string;
	formatting: ResourceLabelFormatting;
}

export interface ResourceLabelTemplateFormatterContext {
	readonly resource: URI;
	readonly home: URI;
	readonly parameters: Map<string, string>;
}

export interface ResourceLabelTemplateFormatter {
	readonly home: URI;
	readonly onDidChangeFormatting: Event<void>;
	readonly formatting: (context: ResourceLabelTemplateFormatterContext) => ResourceLabelFormatting | undefined;
}

export interface ResourceLabelFormatting {
	label: string;
	separator: '/' | '\\' | '';
	tildify?: boolean;
	normalizeDriveLetter?: boolean;
	workspaceSuffix?: string;
	workspaceTooltip?: string;
	authorityPrefix?: string;
	stripPathStartingSeparator?: boolean;
	stripPathSegments?: number;
}

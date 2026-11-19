/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { IEditorOptions, ITextEditorSelection } from '../../editor/common/editor.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IOpenerService = createDecorator<IOpenerService>('openerService');

export type OpenInternalOptions = {

	readonly openToSide?: boolean;

	readonly editorOptions?: IEditorOptions;

	readonly fromUserGesture?: boolean;

	readonly allowCommands?: boolean | readonly string[];
};

export type OpenExternalOptions = {
	readonly openExternal?: boolean;
	readonly allowTunneling?: boolean;
	readonly allowContributedOpeners?: boolean | string;
	readonly fromWorkspace?: boolean;
	readonly skipValidation?: boolean;
};

export type OpenOptions = OpenInternalOptions & OpenExternalOptions;

export type ResolveExternalUriOptions = { readonly allowTunneling?: boolean };

export interface IResolvedExternalUri extends IDisposable {
	resolved: URI;
}

export interface IOpener {
	open(resource: URI | string, options?: OpenInternalOptions | OpenExternalOptions): Promise<boolean>;
}

export interface IExternalOpener {
	openExternal(href: string, ctx: { sourceUri: URI; preferredOpenerId?: string }, token: CancellationToken): Promise<boolean>;
	dispose?(): void;
}

export interface IValidator {
	shouldOpen(resource: URI | string, openOptions?: OpenOptions): Promise<boolean>;
}

export interface IExternalUriResolver {
	resolveExternalUri(resource: URI, options?: OpenOptions): Promise<{ resolved: URI; dispose(): void } | undefined>;
}

export interface IOpenerService {

	readonly _serviceBrand: undefined;

	registerOpener(opener: IOpener): IDisposable;

	registerValidator(validator: IValidator): IDisposable;

	registerExternalUriResolver(resolver: IExternalUriResolver): IDisposable;

	setDefaultExternalOpener(opener: IExternalOpener): void;

	registerExternalOpener(opener: IExternalOpener): IDisposable;

	open(resource: URI | string, options?: OpenInternalOptions | OpenExternalOptions): Promise<boolean>;

	resolveExternalUri(resource: URI, options?: ResolveExternalUriOptions): Promise<IResolvedExternalUri>;
}

export function withSelection(uri: URI, selection: ITextEditorSelection): URI {
	return uri.with({ fragment: `${selection.startLineNumber},${selection.startColumn}${selection.endLineNumber ? `-${selection.endLineNumber}${selection.endColumn ? `,${selection.endColumn}` : ''}` : ''}` });
}

export function extractSelection(uri: URI): { selection: ITextEditorSelection | undefined; uri: URI } {
	let selection: ITextEditorSelection | undefined = undefined;
	const match = /^L?(\d+)(?:,(\d+))?(-L?(\d+)(?:,(\d+))?)?/.exec(uri.fragment);
	if (match) {
		selection = {
			startLineNumber: parseInt(match[1]),
			startColumn: match[2] ? parseInt(match[2]) : 1,
			endLineNumber: match[4] ? parseInt(match[4]) : undefined,
			endColumn: match[4] ? (match[5] ? parseInt(match[5]) : 1) : undefined
		};
		uri = uri.with({ fragment: '' });
	}
	return { selection, uri };
}

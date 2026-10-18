/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IBufferLine, IBufferRange, Terminal } from '@xterm/xterm';
import { URI } from '../../../../../base/common/uri.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ITerminalProcessManager } from '../../../terminal/common/terminal.js';
import { IParsedLink } from './terminalLinkParsing.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { ITerminalExternalLinkProvider } from '../../../terminal/browser/terminal.js';
import { Event } from '../../../../../base/common/event.js';
import { ITerminalBackend } from '../../../../../platform/terminal/common/terminal.js';
import { ITextEditorSelection } from '../../../../../platform/editor/common/editor.js';
import type { IHoverAction } from '../../../../../base/browser/ui/hover/hover.js';
import type { MaybePromise } from '../../../../../base/common/async.js';

export const ITerminalLinkProviderService = createDecorator<ITerminalLinkProviderService>('terminalLinkProviderService');
export interface ITerminalLinkProviderService {
	readonly _serviceBrand: undefined;

	readonly linkProviders: ReadonlySet<ITerminalExternalLinkProvider>;

	readonly onDidAddLinkProvider: Event<ITerminalExternalLinkProvider>;
	readonly onDidRemoveLinkProvider: Event<ITerminalExternalLinkProvider>;

	registerLinkProvider(provider: ITerminalExternalLinkProvider): IDisposable;
}

export interface ITerminalLinkResolver {
	resolveLink(processManager: Pick<ITerminalProcessManager, 'initialCwd' | 'os' | 'remoteAuthority' | 'userHome'> & { backend?: Pick<ITerminalBackend, 'getWslPath'> }, link: string, uri?: URI): Promise<ResolvedLink>;
}

export interface ITerminalLinkDetector {
	readonly xterm: Terminal;

	readonly maxLinkLength: number;

	detect(lines: IBufferLine[], startLine: number, endLine: number): MaybePromise<ITerminalSimpleLink[]>;
}

export interface ITerminalSimpleLink {
	text: string;

	parsedLink?: IParsedLink;

	readonly bufferRange: IBufferRange;

	readonly type: TerminalLinkType;

	uri?: URI;

	contextLine?: string;

	selection?: ITextEditorSelection;

	disableTrimColon?: boolean;

	label?: string;

	actions?: IHoverAction[];

	activate?(text: string): void;
}

export type TerminalLinkType = TerminalBuiltinLinkType | ITerminalExternalLinkType;

export const enum TerminalBuiltinLinkType {
	LocalFile = 'LocalFile',

	LocalFolderOutsideWorkspace = 'LocalFolderOutsideWorkspace',

	LocalFolderInWorkspace = 'LocalFolderInWorkspace',

	Search = 'Search',

	Url = 'Url'
}

export interface ITerminalExternalLinkType {
	id: string;
}

export interface ITerminalLinkOpener {
	open(link: ITerminalSimpleLink): Promise<void>;
}

export type ResolvedLink = IResolvedValidLink | null;

export interface IResolvedValidLink {
	uri: URI;
	link: string;
	isDirectory: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OmitFirstArg<F> = F extends (x: any, ...args: infer P) => infer R ? (...args: P) => R : never;

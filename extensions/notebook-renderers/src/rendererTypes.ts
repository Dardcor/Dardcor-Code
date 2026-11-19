/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OutputItem, RendererContext } from 'vscode-notebook-renderer';
import { Event } from 'vscode';

export interface IDisposable {
	dispose(): void;
}

export interface HtmlRenderingHook {
	postRender(outputItem: OutputItem, element: HTMLElement, signal: AbortSignal): HTMLElement | undefined | Promise<HTMLElement | undefined>;
}

export interface JavaScriptRenderingHook {
	preEvaluate(outputItem: OutputItem, element: HTMLElement, script: string, signal: AbortSignal): string | undefined | Promise<string | undefined>;
}

export interface RenderOptions {
	readonly lineLimit: number;
	readonly outputScrolling: boolean;
	readonly outputWordWrap: boolean;
	readonly linkifyFilePaths: boolean;
	readonly minimalError: boolean;
}

export type IRichRenderContext = RendererContext<void> & { readonly settings: RenderOptions; readonly onDidChangeSettings: Event<RenderOptions> };

export type OutputElementOptions = {
	linesLimit: number;
	scrollable?: boolean;
	error?: boolean;
	trustHtml?: boolean;
	linkifyFilePaths: boolean;
};

export interface OutputWithAppend extends OutputItem {
	appendedText?(): string | undefined;
}

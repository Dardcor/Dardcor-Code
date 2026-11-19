/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRenderedMarkdown, MarkdownRenderOptions, renderMarkdown } from '../../../base/browser/markdownRenderer.js';
import { onUnexpectedError } from '../../../base/common/errors.js';
import { IMarkdownString, MarkdownStringTrustedOptions } from '../../../base/common/htmlContent.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IOpenerService } from '../../opener/common/opener.js';

export interface IMarkdownRenderer {
	render(markdown: IMarkdownString, options?: MarkdownRenderOptions, outElement?: HTMLElement): IRenderedMarkdown;
}

export interface IMarkdownRendererExtraOptions {
	readonly context?: unknown;
}

export interface IMarkdownCodeBlockRenderer {
	renderCodeBlock(languageAlias: string | undefined, value: string, options: IMarkdownRendererExtraOptions): Promise<HTMLElement>;
}


export const IMarkdownRendererService = createDecorator<IMarkdownRendererService>('markdownRendererService');

export interface IMarkdownRendererService extends IMarkdownRenderer {
	readonly _serviceBrand: undefined;

	render(markdown: IMarkdownString, options?: MarkdownRenderOptions & IMarkdownRendererExtraOptions, outElement?: HTMLElement): IRenderedMarkdown;

	setDefaultCodeBlockRenderer(renderer: IMarkdownCodeBlockRenderer): void;
}


export class MarkdownRendererService implements IMarkdownRendererService {
	declare readonly _serviceBrand: undefined;

	private _defaultCodeBlockRenderer: IMarkdownCodeBlockRenderer | undefined;

	constructor(
		@IOpenerService private readonly _openerService: IOpenerService,
	) { }

	render(markdown: IMarkdownString, options?: MarkdownRenderOptions & IMarkdownRendererExtraOptions, outElement?: HTMLElement): IRenderedMarkdown {
		const resolvedOptions = { ...options };

		if (!resolvedOptions.actionHandler) {
			resolvedOptions.actionHandler = (link, mdStr) => {
				return openLinkFromMarkdown(this._openerService, link, mdStr.isTrusted);
			};
		}

		if (!resolvedOptions.codeBlockRenderer) {
			resolvedOptions.codeBlockRenderer = (alias, value) => {
				return this._defaultCodeBlockRenderer?.renderCodeBlock(alias, value, resolvedOptions ?? {}) ?? Promise.resolve(document.createElement('span'));
			};
		}

		const rendered = renderMarkdown(markdown, resolvedOptions, outElement);
		rendered.element.classList.add('rendered-markdown');
		return rendered;
	}

	setDefaultCodeBlockRenderer(renderer: IMarkdownCodeBlockRenderer): void {
		this._defaultCodeBlockRenderer = renderer;
	}
}

export async function openLinkFromMarkdown(openerService: IOpenerService, link: string, isTrusted: boolean | MarkdownStringTrustedOptions | undefined, skipValidation?: boolean): Promise<boolean> {
	try {
		return await openerService.open(link, {
			fromUserGesture: true,
			allowContributedOpeners: true,
			allowCommands: toAllowCommandsOption(isTrusted),
			skipValidation
		});
	} catch (e) {
		onUnexpectedError(e);
		return false;
	}
}

function toAllowCommandsOption(isTrusted: boolean | MarkdownStringTrustedOptions | undefined): boolean | readonly string[] {
	if (isTrusted === true) {
		return true;
	}

	if (isTrusted && Array.isArray(isTrusted.enabledCommands)) {
		return isTrusted.enabledCommands;
	}

	return false;
}

registerSingleton(IMarkdownRendererService, MarkdownRendererService, InstantiationType.Delayed);

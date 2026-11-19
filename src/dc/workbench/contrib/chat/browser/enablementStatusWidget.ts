/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { reset } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IObservable, autorun } from '../../../../base/common/observable.js';
import { localize } from '../../../../nls.js';
import { IMarkdownRendererService } from '../../../../platform/markdown/browser/markdownRenderer.js';
import { ContributionEnablementState } from '../common/enablement.js';

export class EnablementStatusWidget extends Disposable {

	private readonly _renderDisposables = this._register(new MutableDisposable());

	constructor(
		private readonly _container: HTMLElement,
		enablement: IObservable<ContributionEnablementState>,
		private readonly _labels: {
			disabledProfile: string;
			disabledWorkspace: string;
		},
		@IMarkdownRendererService private readonly _markdownRendererService: IMarkdownRendererService,
	) {
		super();
		this._register(autorun(reader => {
			this._render(enablement.read(reader));
		}));
	}

	private _render(state: ContributionEnablementState): void {
		reset(this._container);
		this._renderDisposables.value = undefined;

		let message: string | undefined;
		if (state === ContributionEnablementState.DisabledProfile) {
			message = this._labels.disabledProfile;
		} else if (state === ContributionEnablementState.DisabledWorkspace) {
			message = this._labels.disabledWorkspace;
		}

		if (!message) {
			return;
		}

		const markdown = new MarkdownString('', { isTrusted: true, supportThemeIcons: true });
		markdown.appendMarkdown(`$(${Codicon.info.id})&nbsp;`);
		markdown.appendText(message);
		const rendered = this._markdownRendererService.render(markdown);
		this._renderDisposables.value = rendered;
		this._container.appendChild(rendered.element);
	}
}

export const pluginEnablementLabels = {
	disabledProfile: localize('pluginDisabled', "This plugin is disabled."),
	disabledWorkspace: localize('pluginDisabledWorkspace', "This plugin is disabled for this workspace."),
};

export const mcpServerEnablementLabels = {
	disabledProfile: localize('mcpServerDisabled', "This MCP server is disabled."),
	disabledWorkspace: localize('mcpServerDisabledWorkspace', "This MCP server is disabled for this workspace."),
};

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TextDocument, WebviewPanel } from 'vscode';
import { IVSCodeExtensionContext } from '../../../../../../platform/extContext/common/extensionContext';
import { IInstantiationService } from '../../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { IPosition, ITextDocument } from '../../../lib/src/textDocument';
import { solutionCountTarget } from '../lib/dardcorPanel/common';
import { BaseSuggestionsPanelManager, ListDocumentInterface } from '../panelShared/baseSuggestionsPanelManager';
import { PanelCompletion } from './common';
import { DardcorListDocument } from './dardcorListDocument';
import { DardcorSuggestionsPanel } from './dardcorSuggestionsPanel';
import { dardcorPanelConfig } from './panelConfig';

export class DardcorSuggestionsPanelManager extends BaseSuggestionsPanelManager<PanelCompletion> {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IVSCodeExtensionContext extensionContext: IVSCodeExtensionContext,
	) {
		super(dardcorPanelConfig, instantiationService, extensionContext);
	}

	protected createListDocument(
		wrapped: ITextDocument,
		position: IPosition,
		panel: DardcorSuggestionsPanel
	): ListDocumentInterface {
		return this._instantiationService.createInstance(DardcorListDocument, wrapped, position, panel, solutionCountTarget);
	}

	protected createSuggestionsPanel(
		panel: WebviewPanel,
		document: TextDocument,
		manager: this
	): DardcorSuggestionsPanel {
		return this._instantiationService.createInstance(DardcorSuggestionsPanel, panel, document, manager);
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { autorun, observableSignalFromEvent } from '../../../../../base/common/observable.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { IChatWidget, IChatWidgetService } from '../chat.js';
import { IChatModelFeedbackSurveyService } from './chatModelFeedbackSurveyService.js';

export class ChatModelFeedbackSurveyPromptContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'chat.modelFeedbackSurveyPrompt';

	private readonly widgetListeners = this._register(new DisposableMap<IChatWidget>());

	constructor(
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
		@IChatModelFeedbackSurveyService private readonly surveyService: IChatModelFeedbackSurveyService,
	) {
		super();

		for (const widget of this.chatWidgetService.getAllWidgets()) {
			this.trackWidget(widget);
		}
		this._register(this.chatWidgetService.onDidAddWidget(widget => this.trackWidget(widget)));
		this._register(this.chatWidgetService.onDidRemoveWidget(widget => this.widgetListeners.deleteAndDispose(widget)));
	}

	private trackWidget(widget: IChatWidget): void {
		const listeners = new DisposableStore();

		const viewModelChanged = observableSignalFromEvent('chatFeedbackSurveyViewModel', widget.onDidChangeViewModel);
		let previous: { readonly modelId: string; readonly session: string } | undefined;

		listeners.add(autorun(reader => {
			viewModelChanged.read(reader);
			const modelId = widget.input.selectedLanguageModel.read(reader)?.identifier;
			const sessionResource = widget.viewModel?.sessionResource;
			const session = sessionResource?.toString();

			const last = previous;
			previous = modelId && session ? { modelId, session } : undefined;

			if (last && last.session !== session) {
				previous = undefined;
				return;
			}

			if (!last || !modelId || !sessionResource || last.modelId === modelId) {
				return;
			}

			this.surveyService.notifyModelSwitchedAway(sessionResource, last.modelId, modelId);
		}));

		this.widgetListeners.set(widget, listeners);
	}
}

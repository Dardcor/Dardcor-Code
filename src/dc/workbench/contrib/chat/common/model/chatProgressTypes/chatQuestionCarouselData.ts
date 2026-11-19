/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../../../../base/common/async.js';
import { IMarkdownString } from '../../../../../../base/common/htmlContent.js';
import { IChatQuestion, IChatQuestionAnswers, IChatQuestionCarousel } from '../../chatService/chatService.js';
import { ToolDataSource } from '../../tools/languageModelToolsService.js';

export class ChatQuestionCarouselData implements IChatQuestionCarousel {
	public readonly kind = 'questionCarousel' as const;
	public readonly completion = new DeferredPromise<{ answers: IChatQuestionAnswers | undefined }>();
	public draftAnswers: IChatQuestionAnswers | undefined;
	public draftCurrentIndex: number | undefined;
	public draftCollapsed: boolean | undefined;
	public dismissedByTerminalInput?: boolean;

	public answeredExternally?: boolean;
	public autoReply?: boolean;

	dismiss(answers: IChatQuestionAnswers | undefined): void {
		if (this.isUsed) {
			return;
		}
		this.data = answers ?? {};
		this.isUsed = true;
		this.draftAnswers = undefined;
		this.draftCurrentIndex = undefined;
		this.draftCollapsed = undefined;
		void this.completion.complete({ answers });
	}

	constructor(
		public questions: IChatQuestion[],
		public allowSkip: boolean,
		public resolveId?: string,
		public data?: IChatQuestionAnswers,
		public isUsed?: boolean,
		public message?: string | IMarkdownString,
		public source?: ToolDataSource,
		public terminalId?: string,
		public answerPresentation?: 'conversation',
	) { }

	toJSON(): IChatQuestionCarousel {
		return {
			kind: this.kind,
			questions: this.questions,
			allowSkip: this.allowSkip,
			resolveId: this.resolveId,
			data: this.data,
			isUsed: this.isUsed,
			answeredExternally: this.answeredExternally,
			autoReply: this.autoReply,
			message: this.message,
			source: this.source,
			terminalId: this.terminalId,
			answerPresentation: this.answerPresentation,
		};
	}
}

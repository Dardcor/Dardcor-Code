/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IPromptScrollLayout, PromptFileDiff, PromptTick } from './promptTimelineModel.js';

export interface IPromptReviewFileEvent {
	readonly tick: PromptTick;
	readonly file: URI;
}

export interface IPromptTimelineRail extends IDisposable {
	readonly domNode: HTMLElement;

	readonly onDidSelect: Event<string>;
	readonly onDidReview: Event<PromptTick>;
	readonly onDidReviewFile: Event<IPromptReviewFileEvent>;

	setFilesProvider(provider: (tick: PromptTick) => readonly PromptFileDiff[]): void;
	setTicks(ticks: readonly PromptTick[]): void;

	notifyHardWheel(): void;
	setActive(requestId: string | undefined): void;
	focusTick(requestId: string): void;
	setHostWidth(width: number): void;

	setScrollLayout(layout: IPromptScrollLayout | undefined): void;
}

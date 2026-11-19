/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, EventType } from '../../../../../base/browser/dom.js';
import { IMouseWheelEvent, StandardWheelEvent } from '../../../../../base/browser/mouseEvent.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { autorun } from '../../../../../base/common/observable.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IChatWidget } from '../chat.js';
import { IChatWidgetContrib, ChatWidget } from '../widget/chatWidget.js';
import { ChatAgentLocation, ChatConfiguration } from '../../common/constants.js';
import { MIN_RAIL_PROMPTS, PromptTimelineRailStyle, PROMPT_TIMELINE_CONTRIB_ID, PROMPT_TIMELINE_STICKY_SCROLL_SETTING } from '../../common/promptTimeline.js';
import { PromptTimelineModel } from './promptTimelineModel.js';
import { PromptTimelineGutterRail } from './promptTimelineGutterRail.js';
import { IPromptTimelineRail } from './promptTimelineRail.js';
import { PromptTimelineRulerRail } from './promptTimelineRulerRail.js';
import { PromptTimelineStickyHeader } from './promptTimelineStickyHeader.js';

const HARD_WHEEL_DISTANCE = 20;
const WHEEL_WINDOW_MS = 120;

function supportsPromptTimeline(widget: IChatWidget): boolean {
	return widget.location === ChatAgentLocation.Chat && !widget.rendersInputOnTop;
}

export function observePromptTimelineHostWidth(
	widget: Pick<ChatWidget, 'onDidLayout'>,
	host: HTMLElement,
	rail: Pick<IPromptTimelineRail, 'setHostWidth'>,
): IDisposable {
	rail.setHostWidth(host.clientWidth);
	return widget.onDidLayout(({ width }) => rail.setHostWidth(width));
}

export function isStickyPromptHeaderShown(widget: IChatWidget, configurationService: IConfigurationService): boolean {
	return supportsPromptTimeline(widget)
		&& configurationService.getValue<boolean>(PROMPT_TIMELINE_STICKY_SCROLL_SETTING) === true
		&& configurationService.getValue<boolean>(ChatConfiguration.ExperimentalStickyScrollEnabled) === false;
}

export class PromptTimelineWidgetContrib extends Disposable implements IChatWidgetContrib {

	static readonly ID = PROMPT_TIMELINE_CONTRIB_ID;
	readonly id = PromptTimelineWidgetContrib.ID;

	private readonly _enablement = this._register(new DisposableStore());

	constructor(
		private readonly widget: IChatWidget,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();

		if (!supportsPromptTimeline(widget)) {
			return;
		}

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(PROMPT_TIMELINE_STICKY_SCROLL_SETTING)
				|| e.affectsConfiguration(ChatConfiguration.ExperimentalStickyScrollEnabled)) {
				this._update();
			}
		}));
		this._update();
	}

	private _update(): void {
		this._enablement.clear();
		const stickyEnabled = isStickyPromptHeaderShown(this.widget, this.configurationService);
		if (stickyEnabled) {
			this._createFeature('off', stickyEnabled);
		}
	}

	private _createFeature(railStyle: PromptTimelineRailStyle, stickyEnabled: boolean): void {
		const concreteWidget = this.widget as ChatWidget;
		const model = this._enablement.add(this.instantiationService.createInstance(PromptTimelineModel, concreteWidget));

		const host = this.widget.domNode;
		host.classList.add('prompt-timeline-host');
		this._enablement.add(toDisposable(() => host.classList.remove('prompt-timeline-host', 'prompt-timeline-with-rail')));

		if (railStyle !== 'off') {
			this._createRail(model, host, railStyle);
		}
		if (stickyEnabled) {
			this._createStickyHeader(model);
		}
	}

	private _createRail(model: PromptTimelineModel, host: HTMLElement, railStyle: PromptTimelineRailStyle): void {
		const rail: IPromptTimelineRail = this._enablement.add(
			railStyle === 'gutter' ? new PromptTimelineGutterRail() : new PromptTimelineRulerRail()
		);
		this._enablement.add(observePromptTimelineHostWidth(this.widget as ChatWidget, host, rail));
		if (railStyle === 'ruler') {
			host.classList.add('prompt-timeline-with-rail');
		}
		host.appendChild(rail.domNode);
		this._enablement.add(toDisposable(() => rail.domNode.remove()));

		rail.setFilesProvider(tick => model.getRequestFiles(tick));
		this._enablement.add(rail.onDidSelect(requestId => model.reveal(requestId)));
		this._enablement.add(rail.onDidReview(tick => { void model.reviewChanges(tick); }));
		this._enablement.add(rail.onDidReviewFile(e => { void model.reviewChanges(e.tick, e.file); }));

		if (railStyle === 'ruler') {
			this._enablement.add(this._registerHardWheelDetector(rail));
		}

		const inputPart = this.widget.inputPart;
		this._enablement.add(autorun(reader => {
			rail.domNode.style.setProperty('--prompt-timeline-bottom', `${inputPart.height.read(reader)}px`);
		}));

		const ticksObs = railStyle === 'gutter' ? model.promptTicks : model.ticks;
		const activeObs = railStyle === 'gutter' ? model.activePromptId : model.activeRequestId;

		this._enablement.add(autorun(reader => {
			const ticks = ticksObs.read(reader);
			rail.domNode.classList.toggle('hidden', ticks.length < MIN_RAIL_PROMPTS);
			rail.setTicks(ticks);
		}));

		this._enablement.add(autorun(reader => {
			rail.setActive(activeObs.read(reader));
		}));

		this._enablement.add(autorun(reader => {
			model.onDidChangeScrollLayout.read(reader);
			rail.setScrollLayout(model.getScrollLayout());
		}));

		rail.setHostWidth(host.clientWidth);
	}

	private _createStickyHeader(model: PromptTimelineModel): void {
		const sticky = this._enablement.add(this.instantiationService.createInstance(PromptTimelineStickyHeader, this.widget.domNode));
		this._enablement.add(sticky.onDidActivate(() => model.revealActivePrompt()));
		this._enablement.add(autorun(reader => {
			const active = model.activePrompt.read(reader);
			const pinned = model.activePinned.read(reader);
			if (active && pinned) {
				sticky.update(active.text, active.index, active.total);
			}
			sticky.setVisible(!!active && pinned);
		}));
	}

	private _registerHardWheelDetector(rail: IPromptTimelineRail): IDisposable {
		let wheelAcc = 0;
		let wheelWindowStart = 0;
		return addDisposableListener(this.widget.domNode, EventType.MOUSE_WHEEL, (e: IMouseWheelEvent) => {
			const now = Date.now();
			if (now - wheelWindowStart > WHEEL_WINDOW_MS) {
				wheelAcc = 0;
				wheelWindowStart = now;
			}
			wheelAcc += Math.abs(new StandardWheelEvent(e).deltaY);
			if (wheelAcc >= HARD_WHEEL_DISTANCE) {
				wheelAcc = 0;
				rail.notifyHardWheel();
			}
		}, { capture: true, passive: true });
	}
}

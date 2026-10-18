/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/chatIncrementalRendering.css';
import { getWindow } from '../../../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../../../../platform/configuration/common/configuration.js';
import { ChatConfiguration } from '../../../../common/constants.js';
import { IIncrementalRenderingBuffer } from './buffers/buffer.js';
import { WordBuffer } from './buffers/wordBuffer.js';
import { BUFFER_MODES, BufferModeName } from './buffers/bufferRegistry.js';
import { IIncrementalRenderingAnimation } from './animations/animation.js';
import { ANIMATION_STYLES, AnimationStyleName } from './animations/animationRegistry.js';
import { ANIMATION_DURATION_MS } from './animations/blockAnimations.js';

export class IncrementalDOMMorpher extends Disposable {

	private _lastMarkdown: string = '';

	private _renderedMarkdown: string = '';

	private _revealedChildCount: number = 0;

	private _animationStartTime: number = 0;

	private _batchChildCount: number = 0;

	private _rafScheduled: boolean = false;
	private _pendingMarkdown: string | undefined;
	private _rafHandle: number | undefined;
	private _renderCallback: ((newMarkdown: string) => void) | undefined;
	private _isDrained = true;

	private readonly _onDidDrain = this._register(new Emitter<void>());
	readonly onDidDrain: Event<void> = this._onDidDrain.event;

	private _buffer: IIncrementalRenderingBuffer;
	private _animation: IIncrementalRenderingAnimation;

	constructor(
		private readonly _domNode: HTMLElement,
		@IConfigurationService private readonly _configService: IConfigurationService,
	) {
		super();
		this._buffer = this._createBuffer();
		this._animation = this._createAnimation();

		this._register(this._configService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ChatConfiguration.IncrementalRenderingStyle)) {
				this._animation = this._createAnimation();
			}
			if (e.affectsConfiguration(ChatConfiguration.IncrementalRenderingBuffering)) {
				this._buffer.dispose?.();
				this._buffer = this._createBuffer();
			}
		}));
	}


	private _createBuffer(): IIncrementalRenderingBuffer {
		const raw = this._configService.getValue<string>(ChatConfiguration.IncrementalRenderingBuffering);
		const factory = Object.prototype.hasOwnProperty.call(BUFFER_MODES, raw)
			? BUFFER_MODES[raw as BufferModeName]
			: BUFFER_MODES.paragraph;
		return factory(this._domNode);
	}

	private _createAnimation(): IIncrementalRenderingAnimation {
		const raw = this._configService.getValue<string>(ChatConfiguration.IncrementalRenderingStyle);
		const factory = Object.prototype.hasOwnProperty.call(ANIMATION_STYLES, raw)
			? ANIMATION_STYLES[raw as AnimationStyleName]
			: ANIMATION_STYLES.fade;
		return factory();
	}


	get isDrained(): boolean {
		return this._isDrained;
	}

	setRenderCallback(cb: (newMarkdown: string) => void): void {
		this._renderCallback = cb;
	}

	updateStreamRate(rate: number, isComplete: boolean): void {
		if (this._buffer instanceof WordBuffer) {
			this._buffer.setRate(rate, isComplete);
		}

		if (isComplete && !this._buffer.handlesFlush && this._lastMarkdown.length > this._renderedMarkdown.length) {
			this._pendingMarkdown = this._lastMarkdown;
			this._scheduleRender();
		}
	}

	seed(markdown: string, animateInitial?: boolean): void {
		this._lastMarkdown = markdown;
		this._animationStartTime = 0;

		if (this._buffer.handlesFlush && markdown.length > 0) {
			this._isDrained = false;
			this._renderedMarkdown = '';
			this._revealedChildCount = 0;
			while (this._domNode.firstChild) {
				this._domNode.removeChild(this._domNode.firstChild);
			}
			this._pendingMarkdown = markdown;
			this._scheduleRender();
			return;
		}

		this._renderedMarkdown = markdown;
		this._isDrained = true;
		this._revealedChildCount = animateInitial ? 0 : this._domNode.children.length;
		if (animateInitial) {
			this._animateNewChildren();
		}
	}

	tryMorph(newMarkdown: string): boolean {
		if (!newMarkdown.startsWith(this._lastMarkdown)) {
			return false;
		}

		const appended = newMarkdown.slice(this._lastMarkdown.length);
		if (appended.length === 0) {
			return true;
		}

		this._lastMarkdown = newMarkdown;
		this._isDrained = false;

		if (this._buffer.handlesFlush) {
			this._pendingMarkdown = newMarkdown;
			this._scheduleRender();
			return true;
		}

		const renderable = this._buffer.getRenderable(newMarkdown, this._renderedMarkdown);

		if (renderable.length > this._renderedMarkdown.length) {
			this._renderedMarkdown = renderable;
			this._pendingMarkdown = renderable;
			this._scheduleRender();
		}

		return true;
	}


	private _scheduleRender(): void {
		if (this._rafScheduled) {
			return;
		}
		this._rafScheduled = true;
		const win = getWindow(this._domNode);
		this._rafHandle = win.requestAnimationFrame(() => {
			this._rafScheduled = false;
			this._rafHandle = undefined;
			this._flushRender();
		});
	}

	private _flushRender(): void {
		let markdown = this._pendingMarkdown;
		this._pendingMarkdown = undefined;

		if (markdown === undefined || !this._renderCallback) {
			return;
		}

		if (this._buffer.filterFlush) {
			const filtered = this._buffer.filterFlush(markdown);
			if (filtered === undefined) {
				if (this._buffer.needsNextFrame) {
					this._pendingMarkdown = markdown;
					this._scheduleRender();
				}
				return;
			}
			markdown = filtered;
		}

		this._renderedMarkdown = markdown;
		this._renderCallback(markdown);
		this._animateNewChildren();

		if (this._buffer.needsNextFrame) {
			this._pendingMarkdown = this._lastMarkdown;
			this._scheduleRender();
		} else if (this._renderedMarkdown === this._lastMarkdown && !this._isDrained) {
			this._isDrained = true;
			this._onDidDrain.fire();
		}
	}


	private _animateNewChildren(): void {
		const children = this._domNode.children;
		const currentCount = children.length;

		if (currentCount <= this._revealedChildCount) {
			return;
		}

		const now = Date.now();

		if (this._animationStartTime !== 0 && (now - this._animationStartTime) >= ANIMATION_DURATION_MS) {
			this._revealedChildCount = this._batchChildCount;
			this._animationStartTime = 0;
			this._batchChildCount = 0;
		}

		if (currentCount <= this._revealedChildCount) {
			return;
		}

		if (this._animationStartTime === 0) {
			this._animationStartTime = now;
		}

		this._batchChildCount = currentCount;
		const elapsed = now - this._animationStartTime;

		this._animation.animate(children, this._revealedChildCount, currentCount, elapsed);
	}


	override dispose(): void {
		if (this._rafHandle !== undefined) {
			getWindow(this._domNode).cancelAnimationFrame(this._rafHandle);
			this._rafHandle = undefined;
		}
		this._rafScheduled = false;
		this._pendingMarkdown = undefined;
		this._renderCallback = undefined;
		this._buffer.dispose?.();
		super.dispose();
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../../base/browser/dom.js';
import { IManagedHoverContent } from '../../../../../base/browser/ui/hover/hover.js';
import { IMarkdownString, MarkdownString } from '../../../../../base/common/htmlContent.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IChatSpeechToTextService } from './chatSpeechToTextService.js';

const RING_RADIUS = 7;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export class DictationDownloadRing extends Disposable {

	private readonly _ringElement: SVGSVGElement;
	private readonly _progressCircle: SVGCircleElement;

	constructor(
		container: HTMLElement,
		private readonly _speechToTextService: IChatSpeechToTextService,
	) {
		super();

		const svg = $.SVG<SVGSVGElement>('svg');
		svg.classList.add('dictation-download-ring');
		svg.setAttribute('viewBox', '0 0 16 16');
		svg.setAttribute('aria-hidden', 'true');

		const track = $.SVG<SVGCircleElement>('circle');
		track.classList.add('dictation-download-ring-track');
		track.setAttribute('cx', '8');
		track.setAttribute('cy', '8');
		track.setAttribute('r', String(RING_RADIUS));

		const progress = $.SVG<SVGCircleElement>('circle');
		progress.classList.add('dictation-download-ring-progress');
		progress.setAttribute('cx', '8');
		progress.setAttribute('cy', '8');
		progress.setAttribute('r', String(RING_RADIUS));
		progress.setAttribute('stroke-dasharray', String(RING_CIRCUMFERENCE));

		svg.appendChild(track);
		svg.appendChild(progress);
		container.appendChild(svg);

		this._ringElement = svg;
		this._progressCircle = progress;

		this._register(this._speechToTextService.onDidChangeModelDownloadProgress(() => this.update()));
		this.update();
	}

	update(): void {
		const progress = this._speechToTextService.modelDownloadProgress;
		if (progress === undefined) {
			this._ringElement.classList.add('indeterminate');
			this._progressCircle.style.strokeDashoffset = String(RING_CIRCUMFERENCE * 0.75);
		} else {
			this._ringElement.classList.remove('indeterminate');
			this._progressCircle.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress));
		}
	}
}

export function getDictationDownloadHoverMarkdown(service: Pick<IChatSpeechToTextService, 'currentBackend'>): IMarkdownString {
	const markdown = new MarkdownString('', { supportThemeIcons: true });
	if (service.currentBackend === 'mai') {
		markdown.appendMarkdown(localize('chatStt.hover.connectingTitle', "**Connecting to dictation service**"));
		markdown.appendMarkdown('\n\n');
		markdown.appendMarkdown(localize('chatStt.hover.connecting', "Establishing a connection. This happens each time you start cloud dictation. Click to cancel."));
		return markdown;
	}
	markdown.appendMarkdown(localize('chatStt.hover.title', "**Downloading local model**"));
	markdown.appendMarkdown('\n\n');
	markdown.appendMarkdown(localize('chatStt.hover.preparing', "This happens only the first time you dictate. Click to cancel."));
	return markdown;
}

export function getDictationDownloadHoverContent(service: Pick<IChatSpeechToTextService, 'currentBackend'>): IManagedHoverContent {
	const markdown = getDictationDownloadHoverMarkdown(service);
	return { markdown, markdownNotSupportedFallback: markdown.value };
}

export function getDictationPreparingLabel(service: IChatSpeechToTextService): string {
	if (service.currentBackend === 'mai') {
		return localize('chatStt.preparing.connecting', "Connecting to dictation service…");
	}
	const progress = service.modelDownloadProgress;
	if (typeof progress === 'number') {
		const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
		return localize('chatStt.preparing.downloading', "Downloading speech-to-text model… {0}%", percent);
	}
	return localize('chatStt.preparing.preparing', "Preparing speech-to-text model…");
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, clearNode, Dimension, EventType, h } from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { clamp } from '../../../../base/common/numbers.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IWebviewElement, IWebviewService } from '../../webview/browser/webview.js';
import { ImageCarouselEditorInput } from './imageCarouselEditorInput.js';
import { ICarouselImage, ICarouselSection, isVideoMimeType } from './imageCarouselTypes.js';





interface IFlatImageEntry {
	readonly sectionIndex: number;
	readonly imageIndexInSection: number;
	readonly image: ICarouselImage;
}

type ZoomScale = number | 'fit';

const SCALE_PINCH_FACTOR = 0.075;
const MAX_SCALE = 20;
const MIN_SCALE = 0.1;
const PIXELATION_THRESHOLD = 3;
const ZOOM_LEVELS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.5, 2, 3, 5, 7, 10, 15, 20];

export class ImageCarouselEditor extends EditorPane {
	static readonly ID = 'workbench.editor.imageCarousel';

	private _container: HTMLElement | undefined;
	private _currentIndex: number = 0;
	private _zoomScale: ZoomScale = 'fit';
	private _sections: ReadonlyArray<ICarouselSection> = [];
	private _flatImages: IFlatImageEntry[] = [];
	private readonly _contentDisposables = this._register(new DisposableStore());
	private readonly _imageDisposables = this._register(new DisposableStore());
	private readonly _blobUrlCache = new Map<string, string>();

	private _videoWebview: IWebviewElement | undefined;
	private _elements: {
		root: HTMLElement;
		imageArea: HTMLElement;
		mainImageContainer: HTMLElement;
		mainImage: HTMLImageElement;
		videoContainer: HTMLElement;
		captionText: HTMLElement;
		captionSeparator: HTMLElement;
		counter: HTMLElement;
		ariaStatus: HTMLElement;
		prevBtn: HTMLButtonElement;
		nextBtn: HTMLButtonElement;
		sectionsContainer: HTMLElement;
	} | undefined;
	private _thumbnailElements: HTMLElement[] = [];

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IFileService private readonly _fileService: IFileService,
		@IWebviewService private readonly _webviewService: IWebviewService
	) {
		super(ImageCarouselEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		this._container = h('div.image-carousel-editor').root;
		parent.appendChild(this._container);
	}

	override async setInput(input: ImageCarouselEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);

		this._sections = input.collection.sections;
		this._flatImages = [];
		for (let s = 0; s < this._sections.length; s++) {
			for (let i = 0; i < this._sections[s].images.length; i++) {
				this._flatImages.push({ sectionIndex: s, imageIndexInSection: i, image: this._sections[s].images[i] });
			}
		}
		this._currentIndex = Math.min(input.startIndex, Math.max(0, this._flatImages.length - 1));
		this.buildSlideshow();
	}

	override clearInput(): void {
		this._videoWebview?.dispose();
		this._videoWebview = undefined;
		this._contentDisposables.clear();
		this._imageDisposables.clear();
		this._revokeCachedBlobUrls();
		this._zoomScale = 'fit';
		if (this._container) {
			clearNode(this._container);
		}
		this._elements = undefined;
		this._thumbnailElements = [];
		super.clearInput();
	}

	private _isCurrentVideo(): boolean {
		const entry = this._flatImages[this._currentIndex];
		return !!entry && isVideoMimeType(entry.image.mimeType);
	}

	private buildSlideshow(): void {
		if (!this._container) {
			return;
		}

		this._contentDisposables.clear();
		this._imageDisposables.clear();
		this._revokeCachedBlobUrls();
		clearNode(this._container);

		if (this._flatImages.length === 0) {
			const empty = h('div.empty-message');
			empty.root.textContent = localize('imageCarousel.noImages', "No images to display");
			this._container.appendChild(empty.root);
			return;
		}

		const elements = h('div.slideshow-container', [
			h('div.image-area@imageArea', [
				h('div.main-image-container@mainImageContainer', [
					h('img.main-image@mainImage'),
					h('div.video-container@videoContainer'),
				]),
				h('button.nav-arrow.prev-arrow@prevBtn', { ariaLabel: localize('imageCarousel.previousImage', "Previous image") }, [
					h('span.codicon.codicon-chevron-left', { ariaHidden: 'true' }),
				]),
				h('button.nav-arrow.next-arrow@nextBtn', { ariaLabel: localize('imageCarousel.nextImage', "Next image") }, [
					h('span.codicon.codicon-chevron-right', { ariaHidden: 'true' }),
				]),
			]),
			h('div.bottom-bar@bottomBar', [
				h('div.image-info-bar', [
					h('span.caption-text@captionText'),
					h('span.caption-separator@captionSeparator'),
					h('span.image-counter@counter'),
				]),
				h('div.sections-container@sectionsContainer'),
				h('span.sr-only@ariaStatus'),
			]),
		]);

		elements.root.setAttribute('role', 'group');
		elements.root.setAttribute('aria-label', localize('imageCarousel.ariaLabel', "Images Preview"));
		elements.captionSeparator.setAttribute('aria-hidden', 'true');
		elements.ariaStatus.setAttribute('aria-live', 'polite');
		elements.ariaStatus.setAttribute('aria-atomic', 'true');
		elements.sectionsContainer.setAttribute('role', 'group');
		elements.sectionsContainer.setAttribute('aria-label', localize('imageCarousel.thumbnails', "Image thumbnails"));

		this._elements = {
			root: elements.root,
			imageArea: elements.imageArea,
			mainImageContainer: elements.mainImageContainer,
			mainImage: elements.mainImage as HTMLImageElement,
			videoContainer: elements.videoContainer,
			captionText: elements.captionText,
			captionSeparator: elements.captionSeparator,
			counter: elements.counter,
			ariaStatus: elements.ariaStatus,
			prevBtn: elements.prevBtn as HTMLButtonElement,
			nextBtn: elements.nextBtn as HTMLButtonElement,
			sectionsContainer: elements.sectionsContainer,
		};

		this._elements.mainImage.classList.add('scale-to-fit');
		this._elements.mainImage.alt = '';

		this._elements.videoContainer.style.display = 'none';

		this._contentDisposables.add(addDisposableListener(this._elements.prevBtn, 'click', () => {
			if (this._currentIndex > 0) {
				this._currentIndex--;
				this.updateCurrentImage();
			}
		}));
		this._contentDisposables.add(addDisposableListener(this._elements.nextBtn, 'click', () => {
			if (this._currentIndex < this._flatImages.length - 1) {
				this._currentIndex++;
				this.updateCurrentImage();
			}
		}));

		this._contentDisposables.add(addDisposableListener(elements.root, EventType.KEY_DOWN, e => {
			const event = new StandardKeyboardEvent(e);
			if (event.keyCode === KeyCode.LeftArrow) {
				this.previous();
				event.stopPropagation();
				event.preventDefault();
			} else if (event.keyCode === KeyCode.RightArrow) {
				this.next();
				event.stopPropagation();
				event.preventDefault();
			}
		}));
		elements.root.tabIndex = 0;

		this._contentDisposables.add(addDisposableListener(this._elements.imageArea, EventType.MOUSE_WHEEL, (e: WheelEvent) => {
			if (this._isCurrentVideo()) {
				return;
			}
			const isZoomModifier = isMacintosh ? e.altKey : e.ctrlKey;
			if (!isZoomModifier && !e.ctrlKey) {
				return;
			}
			e.preventDefault();

			if (e.deltaY === 0) {
				return;
			}

			if (this._zoomScale === 'fit') {
				this._initZoomFromFit();
			}

			const delta = e.deltaY > 0 ? 1 : -1;
			this._applyZoom((this._zoomScale as number) * (1 - delta * SCALE_PINCH_FACTOR));
		}, { passive: false }));

		let clickCtrlPressed = false;
		let clickAltPressed = false;
		this._contentDisposables.add(addDisposableListener(this._elements.mainImageContainer, EventType.MOUSE_DOWN, (e: MouseEvent) => {
			if (e.button !== 0) {
				return;
			}
			clickCtrlPressed = e.ctrlKey;
			clickAltPressed = e.altKey;
		}));
		this._contentDisposables.add(addDisposableListener(this._elements.mainImageContainer, EventType.CLICK, (e: MouseEvent) => {
			if (e.button !== 0 || this._isCurrentVideo()) {
				return;
			}
			const isZoomOut = isMacintosh ? clickAltPressed : clickCtrlPressed;
			if (isZoomOut) {
				this._zoomOut();
			} else {
				this._zoomIn();
			}
		}));

		const updateZoomCursor = (e: KeyboardEvent) => {
			const isZoomOut = isMacintosh ? e.altKey : e.ctrlKey;
			this._elements!.mainImageContainer.classList.toggle('zoom-out', isZoomOut);
		};
		this._contentDisposables.add(addDisposableListener(elements.root, EventType.KEY_DOWN, updateZoomCursor));
		this._contentDisposables.add(addDisposableListener(elements.root, EventType.KEY_UP, updateZoomCursor));

		this._thumbnailElements = [];
		let flatIndex = 0;
		for (let s = 0; s < this._sections.length; s++) {
			const section = this._sections[s];

			if (s > 0 && this._sections.length > 1) {
				const separator = h('div.thumbnail-separator').root;
				separator.setAttribute('aria-hidden', 'true');
				this._elements.sectionsContainer.appendChild(separator);
			}

			for (let i = 0; i < section.images.length; i++) {
				const image = section.images[i];
				const currentFlatIndex = flatIndex;
				const isItemVideo = isVideoMimeType(image.mimeType);

				const btn = document.createElement('button');
				btn.className = isItemVideo ? 'thumbnail video-thumbnail' : 'thumbnail';
				btn.ariaLabel = isItemVideo
					? localize('imageCarousel.thumbnailLabelVideo', "Video {0} of {1}", currentFlatIndex + 1, this._flatImages.length)
					: localize('imageCarousel.thumbnailLabelImage', "Image {0} of {1}", currentFlatIndex + 1, this._flatImages.length);

				if (isItemVideo) {
					const icon = h('span.codicon.codicon-play.thumbnail-play-icon');
					icon.root.setAttribute('aria-hidden', 'true');
					btn.appendChild(icon.root);
				} else {
					const img = document.createElement('img');
					img.className = 'thumbnail-image';
					img.alt = image.name;
					const thumbnailDisposables = this._contentDisposables.add(new DisposableStore());

					const markBroken = () => {
						if (thumbnailDisposables.isDisposed) {
							return;
						}

						if (!btn.classList.contains('broken')) {
							btn.classList.add('broken');
							img.removeAttribute('src');
							img.alt = '';
							img.remove();
							const fallback = h('span.codicon.codicon-warning.thumbnail-broken-icon');
							fallback.root.setAttribute('aria-hidden', 'true');
							btn.appendChild(fallback.root);
						}
					};

					this._loadBlobUrl(image).then(url => {
						if (thumbnailDisposables.isDisposed) {
							return;
						}

						if (url) {
							const preloader = new Image();
							thumbnailDisposables.add(addDisposableListener(preloader, 'load', () => {
								if (btn.classList.contains('broken')) {
									return;
								}
								img.src = url;
								if (!img.parentElement) {
									btn.appendChild(img);
								}
							}));
							thumbnailDisposables.add(addDisposableListener(preloader, 'error', () => {
								markBroken();
							}));
							preloader.src = url;
						} else {
							markBroken();
						}
					}, () => {
						markBroken();
					});
					thumbnailDisposables.add(addDisposableListener(img, 'error', () => {
						markBroken();
					}));
				}

				this._contentDisposables.add(addDisposableListener(btn, 'click', () => {
					this._currentIndex = currentFlatIndex;
					this.updateCurrentImage();
				}));

				this._elements.sectionsContainer.appendChild(btn);
				this._thumbnailElements.push(btn);
				flatIndex++;
			}
		}

		this._container.appendChild(elements.root);

		this.updateCurrentImage();
	}

	private async updateCurrentImage(): Promise<void> {
		if (!this._elements) {
			return;
		}

		const navigationIndex = this._currentIndex;

		const entry = this._flatImages[navigationIndex];
		const currentImage = entry.image;
		const isVideo = isVideoMimeType(currentImage.mimeType);

		if (isVideo) {
			this._elements.mainImage.style.display = 'none';
			this._elements.videoContainer.style.display = '';
			this._elements.mainImageContainer.classList.remove('zoomed');
			this._elements.mainImageContainer.style.cursor = 'default';

			const rawData = await this._loadRawData(currentImage);
			if (this._currentIndex !== navigationIndex) {
				return;
			}

			const nonce = generateUuid();
			const videoHtml = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src blob: data:; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';">
<style nonce="${nonce}">html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent}
video{width:100%;height:100%;object-fit:contain;outline:none}</style>
</head><body>
<video id="v" controls></video>
<script nonce="${nonce}">
window.addEventListener("message",function(e){var m=e.data;if(m.type==="loadVideo"){var b=new Blob([m.data],{type:m.mimeType});document.getElementById("v").src=URL.createObjectURL(b);}});
</script>
</body></html>`;

			let webview: IWebviewElement;
			if (!this._videoWebview) {
				webview = this._contentDisposables.add(this._webviewService.createWebviewElement({
					title: currentImage.name,
					options: { disableServiceWorker: true },
					contentOptions: { allowScripts: true },
					extension: undefined,
				}));
				webview.mountTo(this._elements.videoContainer, this.window);
				this._videoWebview = webview;
			} else {
				webview = this._videoWebview;
			}

			webview.setHtml(videoHtml);

			const buffer = (rawData as Uint8Array<ArrayBuffer>).buffer;
			webview.postMessage({ type: 'loadVideo', data: buffer, mimeType: currentImage.mimeType }, [buffer]);
		} else {
			this._elements.videoContainer.style.display = 'none';
			this._elements.mainImage.style.display = '';
			this._elements.mainImageContainer.style.cursor = '';

			const url = await this._loadBlobUrl(currentImage);

			if (this._currentIndex !== navigationIndex) {
				return;
			}

			const tmp = new Image();
			tmp.src = url;
			tmp.decode().then(() => {
				if (this._currentIndex === navigationIndex && this._elements) {
					this._elements.mainImage.src = url;
					this._elements.mainImage.alt = currentImage.name;
				}
			}, () => {
				if (this._currentIndex === navigationIndex && this._elements) {
					this._elements.mainImage.src = url;
					this._elements.mainImage.alt = currentImage.name;
				}
			});
		}

		this._applyZoom('fit');

		if (currentImage.caption) {
			this._elements.captionText.textContent = currentImage.caption;
			this._elements.captionText.style.display = '';
			this._elements.captionSeparator.style.display = '';
		} else {
			this._elements.captionText.textContent = '';
			this._elements.captionText.style.display = 'none';
			this._elements.captionSeparator.style.display = 'none';
		}
		this._elements.counter.textContent = localize('imageCarousel.counter', "{0} / {1}", navigationIndex + 1, this._flatImages.length);

		const itemKind = isVideo
			? localize('imageCarousel.kindVideo', "Video")
			: localize('imageCarousel.kindImage', "Image");
		this._elements.ariaStatus.textContent = currentImage.caption
			? localize('imageCarousel.statusWithCaption', "{0} {1} of {2}: {3}", itemKind, navigationIndex + 1, this._flatImages.length, currentImage.caption)
			: localize('imageCarousel.statusWithName', "{0} {1} of {2}: {3}", itemKind, navigationIndex + 1, this._flatImages.length, currentImage.name);

		this._elements.prevBtn.disabled = navigationIndex === 0;
		this._elements.nextBtn.disabled = navigationIndex === this._flatImages.length - 1;

		for (let i = 0; i < this._thumbnailElements.length; i++) {
			const isActive = i === navigationIndex;
			const thumbnail = this._thumbnailElements[i];
			thumbnail.classList.toggle('active', isActive);
			if (isActive) {
				thumbnail.setAttribute('aria-current', 'page');
			} else {
				thumbnail.removeAttribute('aria-current');
			}
		}

		const activeThumbnail = this._thumbnailElements[navigationIndex];
		if (activeThumbnail) {
			activeThumbnail.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		}

		if (this.input instanceof ImageCarouselEditorInput) {
			const currentSection = this._sections[entry.sectionIndex];
			this.input.setName(currentSection.title || this.input.collection.title);
		}

		this._preloadAdjacentImages();
	}

	private async _loadBlobUrl(image: ICarouselImage): Promise<string> {
		const cached = this._blobUrlCache.get(image.id);
		if (cached) {
			return cached;
		}

		let buffer: Uint8Array;
		if (image.data) {
			buffer = image.data instanceof Uint8Array ? image.data : image.data.buffer;
		} else if (image.uri) {
			const content = await this._fileService.readFile(image.uri);
			buffer = content.value.buffer;
		} else {
			return '';
		}

		const blob = new Blob([buffer as Uint8Array<ArrayBuffer>], { type: image.mimeType });
		const url = URL.createObjectURL(blob);
		this._blobUrlCache.set(image.id, url);
		return url;
	}

	private _revokeCachedBlobUrls(): void {
		for (const url of this._blobUrlCache.values()) {
			URL.revokeObjectURL(url);
		}
		this._blobUrlCache.clear();
	}

	private async _loadRawData(image: ICarouselImage): Promise<Uint8Array> {
		if (image.data) {
			return image.data instanceof Uint8Array ? image.data : image.data.buffer;
		} else if (image.uri) {
			const content = await this._fileService.readFile(image.uri);
			return content.value.buffer;
		}
		return new Uint8Array(0);
	}

	private _preloadAdjacentImages(): void {
		for (const idx of [this._currentIndex - 1, this._currentIndex + 1]) {
			if (idx >= 0 && idx < this._flatImages.length) {
				const adjacentImage = this._flatImages[idx].image;
				if (isVideoMimeType(adjacentImage.mimeType)) {
					this._loadRawData(adjacentImage).catch(() => { });
				} else {
					this._loadBlobUrl(adjacentImage).then(url => {
						const img = new Image();
						img.src = url;
						img.decode().catch(() => { });
					});
				}
			}
		}
	}

	previous(): void {
		if (this._currentIndex > 0) {
			this._currentIndex--;
			this.updateCurrentImage();
		}
	}

	next(): void {
		if (this._currentIndex < this._flatImages.length - 1) {
			this._currentIndex++;
			this.updateCurrentImage();
		}
	}

	private _initZoomFromFit(): void {
		if (!this._elements) {
			return;
		}
		const img = this._elements.mainImage;
		if (img.naturalWidth > 0) {
			this._zoomScale = img.clientWidth / img.naturalWidth;
		} else {
			this._zoomScale = 1;
		}
	}

	private _zoomIn(): void {
		if (this._zoomScale === 'fit') {
			this._initZoomFromFit();
		}
		const scale = this._zoomScale as number;
		let i = 0;
		for (; i < ZOOM_LEVELS.length; ++i) {
			if (ZOOM_LEVELS[i] > scale) {
				break;
			}
		}
		this._applyZoom(ZOOM_LEVELS[i] ?? MAX_SCALE);
	}

	private _zoomOut(): void {
		if (this._zoomScale === 'fit') {
			this._initZoomFromFit();
		}
		const scale = this._zoomScale as number;
		let i = ZOOM_LEVELS.length - 1;
		for (; i >= 0; --i) {
			if (ZOOM_LEVELS[i] < scale) {
				break;
			}
		}
		this._applyZoom(ZOOM_LEVELS[i] ?? MIN_SCALE);
	}

	private _applyZoom(newScale: ZoomScale): void {
		if (!this._elements) {
			return;
		}

		const container = this._elements.mainImageContainer;
		const img = this._elements.mainImage;

		if (newScale === 'fit') {
			this._zoomScale = 'fit';
			img.classList.add('scale-to-fit');
			img.classList.remove('pixelated');
			img.style.zoom = '';
			const wasZoomed = container.classList.contains('zoomed');
			container.classList.remove('zoomed');
			container.classList.remove('zoom-out');
			if (wasZoomed) {
				container.scrollTo(0, 0);
			}
		} else {
			const scale = clamp(newScale, MIN_SCALE, MAX_SCALE);
			this._zoomScale = scale;

			const dx = container.scrollWidth > 0
				? (container.scrollLeft + container.clientWidth / 2) / container.scrollWidth
				: 0.5;
			const dy = container.scrollHeight > 0
				? (container.scrollTop + container.clientHeight / 2) / container.scrollHeight
				: 0.5;

			img.classList.remove('scale-to-fit');
			img.classList.toggle('pixelated', scale >= PIXELATION_THRESHOLD);
			img.style.zoom = String(scale);
			container.classList.add('zoomed');

			const newScrollX = container.scrollWidth * dx - container.clientWidth / 2;
			const newScrollY = container.scrollHeight * dy - container.clientHeight / 2;
			container.scrollTo(newScrollX, newScrollY);
		}
	}

	override focus(): void {
		super.focus();
		this._elements?.root.focus();
	}

	override layout(dimension: Dimension): void {
		if (this._container) {
			this._container.style.width = `${dimension.width}px`;
			this._container.style.height = `${dimension.height}px`;
		}
	}
}

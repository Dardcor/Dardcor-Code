/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { renderAsPlaintext } from '../../../../base/browser/markdownRenderer.js';
import { IMarkdownString } from '../../../../base/common/htmlContent.js';
import { stripIcons } from '../../../../base/common/iconLabels.js';
import { getMediaMime } from '../../../../base/common/mime.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { localize } from '../../../../nls.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import type { IChatRequestVariableEntry } from '../common/attachments/chatVariableEntries.js';
import { extractImagesFromChatRequest, extractImagesFromChatResponse, extractImagesFromChatVariables, IChatExtractedImage } from '../common/chatImageExtraction.js';
import { IChatRequestViewModel, IChatResponseViewModel, isRequestVM, isResponseVM } from '../common/model/chatViewModel.js';
import { IChatWidgetService } from './chat.js';

export const IChatImageCarouselService = createDecorator<IChatImageCarouselService>('chatImageCarouselService');

export interface IChatImageCarouselService {
	readonly _serviceBrand: undefined;

	openCarouselAtResource(resource: URI, data?: Uint8Array, options?: { readonly preferCurrentInput?: boolean }): Promise<void>;
}


export interface ICarouselImage {
	readonly id: string;
	readonly name: string;
	readonly mimeType: string;
	readonly data: Uint8Array;
	readonly caption?: string;
}

export interface ICarouselSection {
	readonly title: string;
	readonly images: ICarouselImage[];
}

export interface ICarouselCollectionArgs {
	readonly collection: {
		readonly id: string;
		readonly title: string;
		readonly sections: ICarouselSection[];
	};
	readonly startIndex: number;
}

export interface ICarouselSingleImageArgs {
	readonly name: string;
	readonly mimeType: string;
	readonly data: Uint8Array;
	readonly title: string;
}



export async function collectCarouselSections(
	items: (IChatRequestViewModel | IChatResponseViewModel)[],
	readFile: (uri: URI) => Promise<Uint8Array>,
	currentInput?: { readonly text: string; readonly attachments: readonly IChatRequestVariableEntry[] },
): Promise<ICarouselSection[]> {
	const sections: ICarouselSection[] = [];

	const requestMap = new Map<string, IChatRequestViewModel>();
	for (const item of items) {
		if (isRequestVM(item)) {
			requestMap.set(item.id, item);
		}
	}

	for (const item of items) {
		if (!isResponseVM(item)) {
			continue;
		}

		const { title: extractedTitle, images: responseImages } = await extractImagesFromChatResponse(item, async uri => VSBuffer.wrap(await readFile(uri)));

		const request = requestMap.get(item.requestId);
		const requestImages = request ? extractImagesFromChatRequest(request) : [];

		const allImages = [...requestImages, ...responseImages];
		const dedupedImages = deduplicateConsecutiveImages(allImages);
		if (dedupedImages.length > 0) {
			sections.push({
				title: request?.messageText ?? extractedTitle,
				images: dedupedImages.map(({ uri, name, mimeType, data, caption }) => ({ id: uri.toString(), name, mimeType, data: data.buffer, caption: toCaptionText(caption) }))
			});
		}
	}

	const respondedRequestIds = new Set(
		items.filter(isResponseVM).map(r => r.requestId)
	);
	for (const item of items) {
		if (!isRequestVM(item) || respondedRequestIds.has(item.id)) {
			continue;
		}
		const requestImages = extractImagesFromChatRequest(item);
		const dedupedImages = deduplicateConsecutiveImages(requestImages);
		if (dedupedImages.length > 0) {
			sections.push({
				title: item.messageText,
				images: dedupedImages.map(({ uri, name, mimeType, data, caption }) => ({ id: uri.toString(), name, mimeType, data: data.buffer, caption: toCaptionText(caption) }))
			});
		}
	}

	if (currentInput) {
		const inputImages = deduplicateConsecutiveImages(extractImagesFromChatVariables(currentInput.attachments));
		if (inputImages.length > 0) {
			sections.push({
				title: currentInput.text.trim() || localize('chatImageCarousel.currentInput', "Current Input"),
				images: inputImages.map(({ uri, name, mimeType, data, caption }) => ({ id: uri.toString(), name, mimeType, data: data.buffer, caption: toCaptionText(caption) }))
			});
		}
	}

	return sections;
}

function toCaptionText(caption: string | IMarkdownString | undefined): string | undefined {
	if (caption === undefined) {
		return undefined;
	}
	return typeof caption === 'string' ? caption : stripIcons(renderAsPlaintext(caption, { useLinkFormatter: true }));
}

function deduplicateConsecutiveImages(images: IChatExtractedImage[]): IChatExtractedImage[] {
	return images.filter((img, index) => {
		if (index === 0) {
			return true;
		}
		return !isEqual(images[index - 1].uri, img.uri);
	});
}

/**
 * Finds the global index of the clicked image across all carousel sections.
 * Tries URI string match, then parsed URI equality, then data buffer equality.
 */
export function findClickedImageIndex(
	sections: ICarouselSection[],
	resource: URI,
	data?: Uint8Array,
	preferredSectionIndex?: number,
): number {
	if (preferredSectionIndex !== undefined && preferredSectionIndex >= 0 && preferredSectionIndex < sections.length) {
		const preferredSection = sections[preferredSectionIndex];
		const uriIndex = findImageInListByUri(preferredSection.images, resource);
		const localIndex = uriIndex >= 0 ? uriIndex : (data ? findImageInListByData(preferredSection.images, data) : -1);
		if (localIndex >= 0) {
			return sections.slice(0, preferredSectionIndex).reduce((total, section) => total + section.images.length, 0) + localIndex;
		}
	}

	let globalOffset = 0;

	for (const section of sections) {
		const localIndex = findImageInListByUri(section.images, resource);
		if (localIndex >= 0) {
			return globalOffset + localIndex;
		}
		globalOffset += section.images.length;
	}

	if (!data) {
		return -1;
	}

	globalOffset = 0;
	for (const section of sections) {
		const localIndex = findImageInListByData(section.images, data);
		if (localIndex >= 0) {
			return globalOffset + localIndex;
		}
		globalOffset += section.images.length;
	}

	return -1;
}

function findImageInListByUri(
	images: ICarouselImage[],
	resource: URI,
): number {
	const uriStr = resource.toString();
	const byUri = images.findIndex(img => img.id === uriStr);
	if (byUri >= 0) {
		return byUri;
	}

	const byParsedUri = images.findIndex(img => {
		try {
			return isEqual(URI.parse(img.id), resource);
		} catch {
			return false;
		}
	});
	if (byParsedUri >= 0) {
		return byParsedUri;
	}

	return -1;
}

function findImageInListByData(images: ICarouselImage[], data: Uint8Array): number {
	const wrapped = VSBuffer.wrap(data);
	return images.findIndex(img => VSBuffer.wrap(img.data).equals(wrapped));
}

export function buildCollectionArgs(
	sections: ICarouselSection[],
	clickedGlobalIndex: number,
	sessionResource: URI,
): ICarouselCollectionArgs {
	const collectionId = sessionResource.toString() + '_carousel';
	const defaultTitle = localize('chatImageCarousel.allImages', "Conversation Images");
	return {
		collection: {
			id: collectionId,
			title: sections.length === 1
				? (sections[0].title || defaultTitle)
				: defaultTitle,
			sections,
		},
		startIndex: clickedGlobalIndex,
	};
}

export function buildSingleImageArgs(resource: URI, data: Uint8Array): ICarouselSingleImageArgs {
	let name = resource.path.split('/').pop() ?? 'image';
	try {
		name = decodeURIComponent(name);
	} catch {
	}
	const mimeType = getMediaMime(resource.path) ?? getMediaMime(name) ?? 'image/png';
	return { name, mimeType, data, title: name };
}


const CAROUSEL_COMMAND = 'workbench.action.chat.openImageInCarousel';

export class ChatImageCarouselService implements IChatImageCarouselService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
		@ICommandService private readonly commandService: ICommandService,
		@IFileService private readonly fileService: IFileService,
	) { }

	async openCarouselAtResource(resource: URI, data?: Uint8Array, options?: { readonly preferCurrentInput?: boolean }): Promise<void> {
		const widget = this.chatWidgetService.lastFocusedWidget;
		if (!widget?.viewModel) {
			await this.openSingleImage(resource, data);
			return;
		}

		const items = widget.viewModel.getItems().filter(
			(item): item is IChatRequestViewModel | IChatResponseViewModel => isRequestVM(item) || isResponseVM(item)
		);
		const readFile = async (uri: URI) => (await this.fileService.readFile(uri)).value.buffer;
		const sections = await collectCarouselSections(items, readFile);
		const currentInputSections = await collectCarouselSections([], readFile, {
			text: widget.getInput(),
			attachments: widget.attachmentModel.attachments,
		});
		const preferredSectionIndex = options?.preferCurrentInput && currentInputSections.length > 0 ? sections.length : undefined;
		sections.push(...currentInputSections);
		const clickedGlobalIndex = findClickedImageIndex(sections, resource, data, preferredSectionIndex);

		if (clickedGlobalIndex === -1 || sections.length === 0) {
			await this.openSingleImage(resource, data);
			return;
		}

		const args = buildCollectionArgs(sections, clickedGlobalIndex, widget.viewModel.sessionResource);
		await this.commandService.executeCommand(CAROUSEL_COMMAND, args);
	}

	private async openSingleImage(resource: URI, data?: Uint8Array): Promise<void> {
		if (!data) {
			const content = await this.fileService.readFile(resource);
			data = content.value.buffer;
		}

		const args = buildSingleImageArgs(resource, data);
		await this.commandService.executeCommand(CAROUSEL_COMMAND, args);
	}
}

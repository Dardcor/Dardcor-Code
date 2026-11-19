/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { Disposable, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { autorun, derived, IObservable, IObservableSignal, IReader, ISettableObservable, observableFromEvent, observableSignal, observableValue, transaction } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { basename, isEqual } from '../../../../../base/common/resources.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IMultiDiffEditorOptions } from '../../../../../editor/common/multiDiffEditor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { MultiDiffEditorInput } from '../../../multiDiffEditor/browser/multiDiffEditorInput.js';
import { MultiDiffEditorItem } from '../../../multiDiffEditor/browser/multiDiffSourceResolverService.js';
import { ChatWidget } from '../widget/chatWidget.js';
import { getChatRequestText } from '../chatRequestText.js';
import { ChatTreeItem } from '../chat.js';
import { IChatResponseFileChangesService } from '../chatResponseFileChangesService.js';
import { IChatEditingService, IEditSessionEntryDiff } from '../../common/editing/chatEditingService.js';
import { IChatRequestViewModel, isRequestVM, isResponseVM } from '../../common/model/chatViewModel.js';
import { budgetBucketPrompts, MAX_TICKS, PromptItem } from './promptBucketing.js';

export interface PromptDiffStat {
	readonly added: number;
	readonly removed: number;
	readonly fileCount: number;
}

export interface PromptFileDiff {
	readonly name: string;
	readonly originalURI: URI;
	readonly modifiedURI: URI;
	readonly diffModifiedURI: URI;
	readonly added: number;
	readonly removed: number;
}

export interface IPromptScrollLayout {
	readonly marks: readonly { readonly requestId: string; readonly top: number }[];
	readonly total: number;
	readonly scrollTop: number;
	readonly scrollHeight: number;
	readonly viewportHeight: number;
}

export interface PromptTick {
	readonly requestId: string;
	readonly allRequestIds: readonly string[];
	readonly text: string;
	readonly timestamp: number;
	readonly count: number;
	readonly ariaLabel: string;
	readonly stat?: PromptDiffStat;
}

const MAX_PREVIEW_LENGTH = 80;

type PromptItemKind = 'request' | 'response' | 'other';

function itemKind(item: ChatTreeItem): PromptItemKind {
	if (isRequestVM(item)) {
		return 'request';
	}
	if (isResponseVM(item)) {
		return 'response';
	}
	return 'other';
}

function isPromptTimelineRequest(item: ChatTreeItem): item is IChatRequestViewModel {
	return isRequestVM(item) && !item.isSystemInitiated;
}

const CHARS_PER_LINE = 48;
const CODE_BLOCK_UNITS = 3;
const MAX_SIGNAL = 60;
const PRIOR_PX_PER_UNIT: Record<PromptItemKind, number> = { request: 18, response: 20, other: 40 };

function getPromptPreview(text: string): string {
	const firstLine = text.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? '';
	return firstLine.length <= MAX_PREVIEW_LENGTH ? firstLine : `${firstLine.slice(0, MAX_PREVIEW_LENGTH)}…`;
}

function promptsEqual(a: readonly PromptItem[], b: readonly PromptItem[]): boolean {
	return a.length === b.length && a.every((p, i) =>
		p.requestId === b[i].requestId && p.text === b[i].text && p.timestamp === b[i].timestamp);
}

export interface IActivePrompt {
	readonly text: string;
	readonly index: number;
	readonly total: number;
}

export class PromptTimelineModel extends Disposable {

	private readonly _prompts: ISettableObservable<readonly PromptItem[]> = observableValue<readonly PromptItem[]>(this, []);

	private readonly _sessionResource: IObservable<URI | undefined>;

	private readonly _editingSession = derived(this, reader => {
		const resource = this._sessionResource.read(reader);
		if (!resource) {
			return undefined;
		}
		this.chatEditingService.editingSessionsObs.read(reader);
		return this.chatEditingService.getEditingSession(resource);
	});

	private readonly _baseTicks = derived<readonly PromptTick[]>(this, reader => {
		const prompts = this._prompts.read(reader);
		return budgetBucketPrompts(prompts, Date.now(), MAX_TICKS).map((bucket): PromptTick => ({
			requestId: bucket.prompt.requestId,
			allRequestIds: bucket.prompts.map(p => p.requestId),
			text: bucket.prompt.text,
			timestamp: bucket.prompt.timestamp,
			count: bucket.count,
			ariaLabel: bucket.count === 1
				? localize('promptTimeline.tick', "Prompt: {0}", bucket.prompt.text)
				: localize('promptTimeline.tickGrouped', "{0} prompts starting with: {1}", bucket.count, bucket.prompt.text),
		}));
	});

	private readonly _ticks = derived<readonly PromptTick[]>(this, reader => {
		const base = this._baseTicks.read(reader);
		return base.map(tick => {
			const stat = this._statForRequests(tick.allRequestIds, reader);
			return stat ? { ...tick, stat } : tick;
		});
	});
	get ticks(): IObservable<readonly PromptTick[]> { return this._ticks; }

	private readonly _promptTicks = derived<readonly PromptTick[]>(this, reader => {
		const prompts = this._prompts.read(reader);
		return prompts.map((prompt): PromptTick => {
			const base: PromptTick = {
				requestId: prompt.requestId,
				allRequestIds: [prompt.requestId],
				text: prompt.text,
				timestamp: prompt.timestamp,
				count: 1,
				ariaLabel: localize('promptTimeline.tick', "Prompt: {0}", prompt.text),
			};
			const stat = this._statForRequests(base.allRequestIds, reader);
			return stat ? { ...base, stat } : base;
		});
	});
	get promptTicks(): IObservable<readonly PromptTick[]> { return this._promptTicks; }

	private readonly _activeRequestId: ISettableObservable<string | undefined> = observableValue<string | undefined>(this, undefined);
	get activeRequestId(): IObservable<string | undefined> { return this._activeRequestId; }

	private readonly _activePromptId: ISettableObservable<string | undefined> = observableValue<string | undefined>(this, undefined);
	get activePromptId(): IObservable<string | undefined> { return this._activePromptId; }

	private readonly _scrollPinned: ISettableObservable<boolean> = observableValue<boolean>(this, false);
	get activePinned(): IObservable<boolean> { return this._scrollPinned; }

	private readonly _activePrompt = derived<IActivePrompt | undefined>(this, reader => {
		const id = this._activePromptId.read(reader);
		if (id === undefined) {
			return undefined;
		}
		const prompts = this._prompts.read(reader);
		const index = prompts.findIndex(p => p.requestId === id);
		return index < 0 ? undefined : { text: prompts[index].text, index: index + 1, total: prompts.length };
	});
	get activePrompt(): IObservable<IActivePrompt | undefined> { return this._activePrompt; }

	private readonly _scrollLayoutSignal: IObservableSignal<void> = observableSignal<void>(this);
	get onDidChangeScrollLayout(): IObservable<void> { return this._scrollLayoutSignal; }

	private readonly _viewModelListener = this._register(new MutableDisposable());

	private readonly _signalCache = new Map<string, { version: number; signal: number }>();

	private readonly _previewCache = new Map<string, { messageText: string; preview: string }>();

	constructor(
		private readonly widget: ChatWidget,
		@IChatEditingService private readonly chatEditingService: IChatEditingService,
		@IChatResponseFileChangesService private readonly chatResponseFileChangesService: IChatResponseFileChangesService,
		@IEditorService private readonly editorService: IEditorService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IFileService private readonly fileService: IFileService,
	) {
		super();
		this._sessionResource = observableFromEvent(this, this.widget.onDidChangeViewModel, () => this.widget.viewModel?.sessionResource);
		this._register(this.widget.onDidChangeViewModel(() => this._bindViewModel()));
		this._register(this.widget.onDidScroll(() => { this._updateActive(); this._triggerScrollLayout(); }));
		this._register(this.widget.onDidChangeContentHeight(() => this._triggerScrollLayout()));
		this._register(autorun(reader => {
			this._baseTicks.read(reader);
			this._updateActive();
			this._triggerScrollLayout();
		}));
		this._bindViewModel();
	}

	private _triggerScrollLayout(): void {
		transaction(tx => this._scrollLayoutSignal.trigger(tx));
	}

	getScrollLayout(): IPromptScrollLayout | undefined {
		const layout = this._computeAdaptiveLayout();
		if (!layout) {
			return undefined;
		}
		const { items, tops, total } = layout;
		const marks: { requestId: string; top: number }[] = [];
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (isPromptTimelineRequest(item)) {
				marks.push({ requestId: item.id, top: tops[i] });
			}
		}
		return { marks, total, scrollTop: this.widget.scrollTop, scrollHeight: this.widget.scrollHeight, viewportHeight: this.widget.viewportHeight };
	}

	private _computeAdaptiveLayout(): { items: readonly ChatTreeItem[]; tops: number[]; total: number } | undefined {
		const items = this.widget.viewModel?.getItems();
		if (!items) {
			return undefined;
		}

		const measuredPx: Record<PromptItemKind, number> = { request: 0, response: 0, other: 0 };
		const measuredSignal: Record<PromptItemKind, number> = { request: 0, response: 0, other: 0 };
		for (const item of items) {
			const measured = item.currentRenderedHeight;
			if (measured !== undefined && measured > 0) {
				const kind = itemKind(item);
				measuredPx[kind] += measured;
				measuredSignal[kind] += this._itemSignal(item);
			}
		}
		const pxPerUnit = (kind: PromptItemKind): number =>
			measuredSignal[kind] > 0 ? measuredPx[kind] / measuredSignal[kind] : PRIOR_PX_PER_UNIT[kind];

		const tops: number[] = [];
		let acc = 0;
		for (const item of items) {
			tops.push(acc);
			const measured = item.currentRenderedHeight;
			acc += (measured !== undefined && measured > 0)
				? measured
				: pxPerUnit(itemKind(item)) * this._itemSignal(item);
		}
		return { items, tops, total: acc };
	}

	private _itemSignal(item: ChatTreeItem): number {
		if (isRequestVM(item)) {
			const cached = this._signalCache.get(item.id);
			const version = item.messageText.length;
			if (cached && cached.version === version) {
				return cached.signal;
			}
			const signal = Math.min(MAX_SIGNAL, 1 + Math.ceil(version / CHARS_PER_LINE));
			this._signalCache.set(item.id, { version, signal });
			return signal;
		}
		if (isResponseVM(item)) {
			const parts = item.response.value;
			const cached = this._signalCache.get(item.id);
			if (cached && cached.version === parts.length) {
				return cached.signal;
			}
			const text = item.response.getMarkdown();
			const codeBlocks = Math.floor((text.match(/```/g)?.length ?? 0) / 2);
			const lines = Math.ceil(text.length / CHARS_PER_LINE);
			const signal = Math.min(MAX_SIGNAL, 1 + lines + codeBlocks * CODE_BLOCK_UNITS);
			this._signalCache.set(item.id, { version: parts.length, signal });
			return signal;
		}
		return 1;
	}

	private _requestPreview(item: IChatRequestViewModel): string {
		const messageText = item.messageText;
		const cached = this._previewCache.get(item.id);
		if (cached && cached.messageText === messageText) {
			return cached.preview;
		}
		const preview = getPromptPreview(getChatRequestText(item));
		this._previewCache.set(item.id, { messageText, preview });
		return preview;
	}

	private _bindViewModel(): void {
		this._signalCache.clear();
		this._previewCache.clear();
		this._viewModelListener.value = this.widget.viewModel?.onDidChange(() => this._recompute());
		this._recompute();
	}

	private _recompute(): void {
		const prompts: PromptItem[] = [];
		for (const item of this.widget.viewModel?.getItems() ?? []) {
			if (isPromptTimelineRequest(item)) {
				prompts.push({ requestId: item.id, text: this._requestPreview(item), timestamp: item.timestamp });
			}
		}

		if (promptsEqual(prompts, this._prompts.get())) {
			this._updateActive();
			return;
		}
		this._prompts.set(prompts, undefined);
	}

	private _updateActive(): void {
		const ticks = this._baseTicks.get();
		const items = this.widget.viewModel?.getItems();
		if (!items || ticks.length === 0) {
			transaction(tx => {
				this._activeRequestId.set(undefined, tx);
				this._activePromptId.set(undefined, tx);
				this._scrollPinned.set(false, tx);
			});
			return;
		}

		const scrollTop = this.widget.scrollTop;
		const isScrolledToBottom = scrollTop + this.widget.viewportHeight >= this.widget.scrollHeight - 2;
		let activeRequestId: string | undefined;
		let activeTimestamp = 0;
		let activeTop = -1;
		if (isScrolledToBottom) {
			for (let i = items.length - 1; i >= 0; i--) {
				const item = items[i];
				if (!isPromptTimelineRequest(item)) {
					continue;
				}
				const top = this.widget.getElementTop(item);
				if (top === undefined || top > scrollTop) {
					continue;
				}
				activeRequestId = item.id;
				activeTimestamp = item.timestamp;
				activeTop = top;
				break;
			}
		} else {
			for (const item of items) {
				if (isPromptTimelineRequest(item)) {
					const top = this.widget.getElementTop(item);
					if (top === undefined) {
						continue;
					}
					if (top > scrollTop) {
						break;
					}
					activeRequestId = item.id;
					activeTimestamp = item.timestamp;
					activeTop = top;
				}
			}
		}

		if (activeRequestId === undefined) {
			transaction(tx => {
				this._activeRequestId.set(ticks.at(0)?.requestId, tx);
				this._activePromptId.set(this._prompts.get().at(0)?.requestId, tx);
				this._scrollPinned.set(false, tx);
			});
			return;
		}

		let activeTick = ticks.find(t => t.allRequestIds.includes(activeRequestId!));
		if (!activeTick) {
			for (const tick of ticks) {
				if (tick.timestamp <= activeTimestamp) {
					activeTick = tick;
				} else {
					break;
				}
			}
		}
		const pinned = activeTop < scrollTop - 2;
		transaction(tx => {
			this._activeRequestId.set((activeTick ?? ticks[ticks.length - 1]).requestId, tx);
			this._activePromptId.set(activeRequestId, tx);
			this._scrollPinned.set(pinned, tx);
		});
	}

	reveal(requestId: string): void {
		const items = this.widget.viewModel?.getItems();
		const index = items?.findIndex(i => isRequestVM(i) && i.id === requestId) ?? -1;
		if (items && index >= 0) {
			this.widget.reveal(items[index], 0);
		}
		const owningTick = this._baseTicks.get().find(t => t.allRequestIds.includes(requestId));
		this._activeRequestId.set(owningTick?.requestId ?? requestId, undefined);
	}

	revealActivePrompt(): void {
		const id = this._activePromptId.get();
		if (id !== undefined) {
			this.reveal(id);
		}
	}

	getRequestFiles(tick: PromptTick): readonly PromptFileDiff[] {
		const byPath = new Map<string, PromptFileDiff>();
		for (const requestId of tick.allRequestIds) {
			for (const diff of this._diffsForRequest(requestId)) {
				if (diff.identical) {
					continue;
				}
				const key = diff.modifiedURI.toString();
				const existing = byPath.get(key);
				if (existing) {
					byPath.set(key, {
						...existing,
						diffModifiedURI: diff.modifiedSnapshotURI ?? diff.modifiedURI,
						added: existing.added + diff.added,
						removed: existing.removed + diff.removed,
					});
				} else {
					byPath.set(key, {
						name: basename(diff.modifiedURI),
						originalURI: diff.originalURI,
						modifiedURI: diff.modifiedURI,
						diffModifiedURI: diff.modifiedSnapshotURI ?? diff.modifiedURI,
						added: diff.added,
						removed: diff.removed,
					});
				}
			}
		}
		return [...byPath.values()];
	}

	async reviewChanges(tick: PromptTick, file?: URI): Promise<void> {
		const files = this.getRequestFiles(tick);
		if (files.length === 0) {
			return;
		}
		const items: MultiDiffEditorItem[] = [];
		let revealResource: { original: URI | undefined; modified: URI | undefined } | undefined;
		for (const f of files) {
			const [originalURI, modifiedURI] = await this._readableSides(f);
			if (!originalURI && !modifiedURI) {
				continue;
			}
			items.push(new MultiDiffEditorItem(originalURI, modifiedURI, f.modifiedURI));
			if (file && isEqual(f.modifiedURI, file)) {
				revealResource = { original: originalURI, modified: modifiedURI };
			}
		}
		if (items.length === 0) {
			return;
		}
		const source = URI.parse(`multi-diff-editor:prompt-timeline/${generateUuid()}`);
		const input = this.instantiationService.createInstance(
			MultiDiffEditorInput,
			source,
			localize('promptTimeline.reviewTitle', "Changes · {0}", tick.text),
			items,
			false,
		);
		const options: IMultiDiffEditorOptions | undefined = revealResource
			? { viewState: { revealData: { resource: revealResource } } }
			: undefined;
		await this.editorService.openEditor(input, options);
	}

	private async _readableSides(file: PromptFileDiff): Promise<[URI | undefined, URI | undefined]> {
		const hasFrozenOriginal = !isEqual(file.originalURI, file.modifiedURI);
		const hasFrozenModified = !isEqual(file.diffModifiedURI, file.modifiedURI);
		const [frozenOriginalReadable, frozenModifiedReadable, liveModifiedReadable] = await Promise.all([
			hasFrozenOriginal ? this._canRead(file.originalURI) : Promise.resolve(false),
			hasFrozenModified ? this._canRead(file.diffModifiedURI) : Promise.resolve(false),
			this._canRead(file.modifiedURI),
		]);
		const modified = frozenModifiedReadable ? file.diffModifiedURI
			: liveModifiedReadable ? file.modifiedURI
				: undefined;
		return [frozenOriginalReadable ? file.originalURI : undefined, modified];
	}

	private async _canRead(resource: URI): Promise<boolean> {
		try {
			await this.fileService.readFile(resource, { length: 1 });
			return true;
		} catch {
			return false;
		}
	}

	private _diffsForRequest(requestId: string, reader?: IReader): readonly IEditSessionEntryDiff[] {
		const resource = reader ? this._sessionResource.read(reader) : this._sessionResource.get();
		if (resource) {
			const provided = this.chatResponseFileChangesService.getChangesForRequest(resource, requestId);
			if (provided) {
				return reader ? provided.read(reader) : provided.get();
			}
		}
		const session = reader ? this._editingSession.read(reader) : this._editingSession.get();
		if (session) {
			const obs = session.getDiffsForFilesInRequest(requestId);
			return reader ? obs.read(reader) : obs.get();
		}
		return [];
	}

	private _statForRequests(requestIds: readonly string[], reader?: IReader): PromptDiffStat | undefined {
		let added = 0;
		let removed = 0;
		const files = new Set<string>();
		for (const requestId of requestIds) {
			for (const diff of this._diffsForRequest(requestId, reader)) {
				if (diff.identical) {
					continue;
				}
				added += diff.added;
				removed += diff.removed;
				files.add(diff.modifiedURI.toString());
			}
		}
		return files.size > 0 ? { added, removed, fileCount: files.size } : undefined;
	}
}

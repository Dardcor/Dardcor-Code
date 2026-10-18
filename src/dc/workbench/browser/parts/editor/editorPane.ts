/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Composite } from '../../composite.js';
import { IEditorPane, GroupIdentifier, IEditorMemento, IEditorOpenContext, isEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { LRUCache, Touch } from '../../../../base/common/map.js';
import { URI } from '../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { isEmptyObject } from '../../../../base/common/types.js';
import { DEFAULT_EDITOR_MIN_DIMENSIONS, DEFAULT_EDITOR_MAX_DIMENSIONS } from './editor.js';
import { joinPath, IExtUri, isEqual } from '../../../../base/common/resources.js';
import { indexOfPath } from '../../../../base/common/extpath.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { ITextResourceConfigurationChangeEvent, ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { IBoundarySashes } from '../../../../base/browser/ui/sash/sash.js';
import { getWindowById } from '../../../../base/browser/dom.js';

export abstract class EditorPane<MementoType extends object = object> extends Composite<MementoType> implements IEditorPane {


	readonly onDidChangeSizeConstraints = Event.None;

	protected readonly _onDidChangeControl = this._register(new Emitter<void>());
	readonly onDidChangeControl = this._onDidChangeControl.event;


	private static readonly EDITOR_MEMENTOS = new Map<string, EditorMemento<unknown>>();

	get minimumWidth() { return DEFAULT_EDITOR_MIN_DIMENSIONS.width; }
	get maximumWidth() { return DEFAULT_EDITOR_MAX_DIMENSIONS.width; }
	get minimumHeight() { return DEFAULT_EDITOR_MIN_DIMENSIONS.height; }
	get maximumHeight() { return DEFAULT_EDITOR_MAX_DIMENSIONS.height; }

	protected _input: EditorInput | undefined;
	get input(): EditorInput | undefined { return this._input; }

	protected _options: IEditorOptions | undefined;
	get options(): IEditorOptions | undefined { return this._options; }

	get window() { return getWindowById(this.group.windowId, true).window; }

	get scopedContextKeyService(): IContextKeyService | undefined { return undefined; }

	constructor(
		id: string,
		readonly group: IEditorGroup,
		telemetryService: ITelemetryService,
		themeService: IThemeService,
		storageService: IStorageService
	) {
		super(id, telemetryService, themeService, storageService);
	}

	override create(parent: HTMLElement): void {
		super.create(parent);

		this.createEditor(parent);
	}

	protected abstract createEditor(parent: HTMLElement): void;

	async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		this._input = input;
		this._options = options;
	}

	clearInput(): void {
		this._input = undefined;
		this._options = undefined;
	}

	setOptions(options: IEditorOptions | undefined): void {
		this._options = options;
	}

	override setVisible(visible: boolean): void {
		super.setVisible(visible);

		this.setEditorVisible(visible);
	}

	protected setEditorVisible(visible: boolean): void {
	}

	setBoundarySashes(_sashes: IBoundarySashes) {
	}

	protected getEditorMemento<T>(editorGroupService: IEditorGroupsService, configurationService: ITextResourceConfigurationService, key: string, limit: number = 10): IEditorMemento<T> {
		const mementoKey = `${this.getId()}${key}`;

		let editorMemento = EditorPane.EDITOR_MEMENTOS.get(mementoKey);
		if (!editorMemento) {
			editorMemento = this._register(new EditorMemento(this.getId(), key, this.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE), limit, editorGroupService, configurationService));
			EditorPane.EDITOR_MEMENTOS.set(mementoKey, editorMemento);
		}

		return editorMemento as IEditorMemento<T>;
	}

	getViewState(): object | undefined {

		return undefined;
	}

	protected override saveState(): void {

		for (const [, editorMemento] of EditorPane.EDITOR_MEMENTOS) {
			if (editorMemento.id === this.getId()) {
				editorMemento.saveState();
			}
		}

		super.saveState();
	}

	override dispose(): void {
		this._input = undefined;
		this._options = undefined;

		super.dispose();
	}
}

interface MapGroupToMemento<T> {
	[group: GroupIdentifier]: T;
}

export class EditorMemento<T> extends Disposable implements IEditorMemento<T> {

	private static readonly SHARED_EDITOR_STATE = -1;

	private cache: LRUCache<string, MapGroupToMemento<T>> | undefined;
	private cleanedUp = false;
	private editorDisposables: Map<EditorInput, IDisposable> | undefined;
	private shareEditorState = false;

	constructor(
		readonly id: string,
		private readonly key: string,
		private readonly memento: T,
		private readonly limit: number,
		private readonly editorGroupService: IEditorGroupsService,
		private readonly configurationService: ITextResourceConfigurationService
	) {
		super();

		this.updateConfiguration(undefined);
		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.configurationService.onDidChangeConfiguration(e => this.updateConfiguration(e)));
	}

	private updateConfiguration(e: ITextResourceConfigurationChangeEvent | undefined): void {
		if (!e || e.affectsConfiguration(undefined, 'workbench.editor.sharedViewState')) {
			this.shareEditorState = this.configurationService.getValue(undefined, 'workbench.editor.sharedViewState') === true;
		}
	}

	saveEditorState(group: IEditorGroup, resource: URI, state: T): void;
	saveEditorState(group: IEditorGroup, editor: EditorInput, state: T): void;
	saveEditorState(group: IEditorGroup, resourceOrEditor: URI | EditorInput, state: T): void {
		const resource = this.doGetResource(resourceOrEditor);
		if (!resource || !group) {
			return;
		}

		const cache = this.doLoad();

		let mementosForResource = cache.get(resource.toString());
		if (!mementosForResource) {
			mementosForResource = Object.create(null) as MapGroupToMemento<T>;
			cache.set(resource.toString(), mementosForResource);
		}

		mementosForResource[group.id] = state;

		if (this.shareEditorState) {
			mementosForResource[EditorMemento.SHARED_EDITOR_STATE] = state;
		}

		if (isEditorInput(resourceOrEditor)) {
			this.clearEditorStateOnDispose(resource, resourceOrEditor);
		}
	}

	loadEditorState(group: IEditorGroup, resource: URI): T | undefined;
	loadEditorState(group: IEditorGroup, editor: EditorInput): T | undefined;
	loadEditorState(group: IEditorGroup, resourceOrEditor: URI | EditorInput): T | undefined {
		const resource = this.doGetResource(resourceOrEditor);
		if (!resource || !group) {
			return;
		}

		const cache = this.doLoad();

		const mementosForResource = cache.get(resource.toString());
		if (mementosForResource) {
			const mementoForResourceAndGroup = mementosForResource[group.id];

			if (mementoForResourceAndGroup) {
				return mementoForResourceAndGroup;
			}

			if (this.shareEditorState) {
				return mementosForResource[EditorMemento.SHARED_EDITOR_STATE];
			}
		}

		return undefined;
	}

	clearEditorState(resource: URI, group?: IEditorGroup): void;
	clearEditorState(editor: EditorInput, group?: IEditorGroup): void;
	clearEditorState(resourceOrEditor: URI | EditorInput, group?: IEditorGroup): void {
		if (isEditorInput(resourceOrEditor)) {
			this.editorDisposables?.delete(resourceOrEditor);
		}

		const resource = this.doGetResource(resourceOrEditor);
		if (resource) {
			const cache = this.doLoad();

			if (group) {
				const mementosForResource = cache.get(resource.toString());
				if (mementosForResource) {
					delete mementosForResource[group.id];

					if (isEmptyObject(mementosForResource)) {
						cache.delete(resource.toString());
					}
				}
			}

			else {
				cache.delete(resource.toString());
			}
		}
	}

	clearEditorStateOnDispose(resource: URI, editor: EditorInput): void {
		if (!this.editorDisposables) {
			this.editorDisposables = new Map<EditorInput, IDisposable>();
		}

		if (!this.editorDisposables.has(editor)) {
			this.editorDisposables.set(editor, Event.once(editor.onWillDispose)(() => {
				this.clearEditorState(resource);
				this.editorDisposables?.delete(editor);
			}));
		}
	}

	moveEditorState(source: URI, target: URI, comparer: IExtUri): void {
		const cache = this.doLoad();

		const cacheKeys = [...cache.keys()];
		for (const cacheKey of cacheKeys) {
			const resource = URI.parse(cacheKey);

			if (!comparer.isEqualOrParent(resource, source)) {
				continue;
			}

			let targetResource: URI;
			if (isEqual(source, resource)) {
				targetResource = target;
			} else {
				const index = indexOfPath(resource.path, source.path);
				targetResource = joinPath(target, resource.path.substr(index + source.path.length + 1));
			}

			const value = cache.get(cacheKey, Touch.None);
			if (value) {
				cache.delete(cacheKey);
				cache.set(targetResource.toString(), value);
			}
		}
	}

	private doGetResource(resourceOrEditor: URI | EditorInput): URI | undefined {
		if (isEditorInput(resourceOrEditor)) {
			return resourceOrEditor.resource;
		}

		return resourceOrEditor;
	}

	private doLoad(): LRUCache<string, MapGroupToMemento<T>> {
		if (!this.cache) {
			this.cache = new LRUCache<string, MapGroupToMemento<T>>(this.limit);

			const rawEditorMemento = this.memento[this.key as keyof T];
			if (Array.isArray(rawEditorMemento)) {
				this.cache.fromJSON(rawEditorMemento);
			}
		}

		return this.cache;
	}

	saveState(): void {
		const cache = this.doLoad();

		if (!this.cleanedUp) {
			this.cleanUp();
			this.cleanedUp = true;
		}

		(this.memento as Record<string, unknown>)[this.key] = cache.toJSON();
	}

	private cleanUp(): void {
		const cache = this.doLoad();

		const entries = [...cache.entries()];
		for (const [resource, mapGroupToMementos] of entries) {
			for (const group of Object.keys(mapGroupToMementos)) {
				const groupId: GroupIdentifier = Number(group);
				if (groupId === EditorMemento.SHARED_EDITOR_STATE && this.shareEditorState) {
					continue;
				}

				if (!this.editorGroupService.getGroup(groupId)) {
					delete mapGroupToMementos[groupId];
					if (isEmptyObject(mapGroupToMementos)) {
						cache.delete(resource);
					}
				}
			}
		}
	}
}

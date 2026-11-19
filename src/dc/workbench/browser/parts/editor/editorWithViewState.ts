/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Event } from '../../../../base/common/event.js';
import { IEditorMemento, IEditorCloseEvent, IEditorOpenContext, EditorResourceAccessor, SideBySideEditor } from '../../../common/editor.js';
import { EditorPane } from './editorPane.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { IEditorGroupsService, IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IExtUri } from '../../../../base/common/resources.js';
import { DisposableMap, IDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

export abstract class AbstractEditorWithViewState<T extends object> extends EditorPane {

	private viewState: IEditorMemento<T>;

	private readonly groupListener = this._register(new MutableDisposable());

	private editorViewStateDisposables: DisposableMap<EditorInput, IDisposable> | undefined;

	constructor(
		id: string,
		group: IEditorGroup,
		viewStateStorageKey: string,
		@ITelemetryService telemetryService: ITelemetryService,
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@ITextResourceConfigurationService protected readonly textResourceConfigurationService: ITextResourceConfigurationService,
		@IThemeService themeService: IThemeService,
		@IEditorService protected readonly editorService: IEditorService,
		@IEditorGroupsService protected readonly editorGroupService: IEditorGroupsService
	) {
		super(id, group, telemetryService, themeService, storageService);

		this.viewState = this.getEditorMemento<T>(editorGroupService, textResourceConfigurationService, viewStateStorageKey, 100);
	}

	protected override setEditorVisible(visible: boolean): void {

		this.groupListener.value = this.group.onWillCloseEditor(e => this.onWillCloseEditor(e));

		super.setEditorVisible(visible);
	}

	private onWillCloseEditor(e: IEditorCloseEvent): void {
		const editor = e.editor;
		if (editor === this.input) {
			this.updateEditorViewState(editor);
		}
	}

	override clearInput(): void {

		this.updateEditorViewState(this.input);

		super.clearInput();
	}

	protected override saveState(): void {

		this.updateEditorViewState(this.input);

		super.saveState();
	}

	protected saveCurrentEditorViewState(): void {
		this.updateEditorViewState(this.input);
	}

	private updateEditorViewState(input: EditorInput | undefined): void {
		if (!input || !this.tracksEditorViewState(input)) {
			return;
		}

		const resource = this.toEditorViewStateResource(input);
		if (!resource) {
			return;
		}

		if (!this.tracksDisposedEditorViewState()) {
			if (!this.editorViewStateDisposables) {
				this.editorViewStateDisposables = this._register(new DisposableMap<EditorInput, IDisposable>());
			}

			if (!this.editorViewStateDisposables.has(input)) {
				this.editorViewStateDisposables.set(input, Event.once(input.onWillDispose)(() => {
					this.clearEditorViewState(resource, this.group);
					this.editorViewStateDisposables?.deleteAndDispose(input);
				}));
			}
		}

		if (
			(input.isDisposed() && !this.tracksDisposedEditorViewState()) ||
			(!this.shouldRestoreEditorViewState(input) && !this.group.contains(input))
		) {
			this.clearEditorViewState(resource, this.group);
			this.editorViewStateDisposables?.deleteAndDispose(input);
		}

		else if (!input.isDisposed()) {
			this.saveEditorViewState(resource);
		}
	}

	private shouldRestoreEditorViewState(input: EditorInput, context?: IEditorOpenContext): boolean {

		if (context?.newInGroup) {
			return this.textResourceConfigurationService.getValue<boolean>(EditorResourceAccessor.getOriginalUri(input, { supportSideBySide: SideBySideEditor.PRIMARY }), 'workbench.editor.restoreViewState') !== false ;
		}

		return true;
	}

	override getViewState(): T | undefined {
		const input = this.input;
		if (!input || !this.tracksEditorViewState(input)) {
			return;
		}

		const resource = this.toEditorViewStateResource(input);
		if (!resource) {
			return;
		}

		return this.computeEditorViewState(resource);
	}

	private saveEditorViewState(resource: URI): void {
		const editorViewState = this.computeEditorViewState(resource);
		if (!editorViewState) {
			return;
		}

		this.viewState.saveEditorState(this.group, resource, editorViewState);
	}

	protected loadEditorViewState(input: EditorInput | undefined, context?: IEditorOpenContext): T | undefined {
		if (!input) {
			return undefined;
		}

		if (!this.tracksEditorViewState(input)) {
			return undefined;
		}

		if (!this.shouldRestoreEditorViewState(input, context)) {
			return undefined;
		}

		const resource = this.toEditorViewStateResource(input);
		if (!resource) {
			return;
		}

		return this.viewState.loadEditorState(this.group, resource);
	}

	protected moveEditorViewState(source: URI, target: URI, comparer: IExtUri): void {
		return this.viewState.moveEditorState(source, target, comparer);
	}

	protected clearEditorViewState(resource: URI, group?: IEditorGroup): void {
		this.viewState.clearEditorState(resource, group);
	}


	protected abstract computeEditorViewState(resource: URI): T | undefined;

	protected abstract tracksEditorViewState(input: EditorInput): boolean;

	protected tracksDisposedEditorViewState(): boolean {
		return false;
	}

	protected abstract toEditorViewStateResource(input: EditorInput): URI | undefined;

}

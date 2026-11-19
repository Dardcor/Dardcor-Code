/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../base/common/event.js';
import { URI } from '../../../base/common/uri.js';
import { EditorInputCapabilities, Verbosity, GroupIdentifier, ISaveOptions, IRevertOptions, IMoveResult, IEditorDescriptor, IEditorPane, IUntypedEditorInput, EditorResourceAccessor, AbstractEditorInput, isEditorInput, IEditorIdentifier } from '../editor.js';
import { isEqual } from '../../../base/common/resources.js';
import { ConfirmResult } from '../../../platform/dialogs/common/dialogs.js';
import { IMarkdownString } from '../../../base/common/htmlContent.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../base/common/themables.js';

export interface IEditorCloseHandler {

	showConfirm(): boolean;

	confirm(editors: ReadonlyArray<IEditorIdentifier>): Promise<ConfirmResult>;
}

export interface IUntypedEditorOptions {

	readonly preserveViewState?: GroupIdentifier;

	readonly preserveResource?: boolean;
}

export abstract class EditorInput extends AbstractEditorInput {

	protected readonly _onDidChangeDirty = this._register(new Emitter<void>());
	protected readonly _onDidChangeLabel = this._register(new Emitter<void>());
	protected readonly _onDidChangeCapabilities = this._register(new Emitter<void>());

	private readonly _onWillDispose = this._register(new Emitter<void>());

	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	readonly onDidChangeLabel = this._onDidChangeLabel.event;

	readonly onDidChangeCapabilities = this._onDidChangeCapabilities.event;

	readonly onWillDispose = this._onWillDispose.event;

	readonly closeHandler?: IEditorCloseHandler;

	abstract get typeId(): string;

	abstract get resource(): URI | undefined;

	get editorId(): string | undefined {
		return undefined;
	}

	get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly;
	}

	hasCapability(capability: EditorInputCapabilities): boolean {
		if (capability === EditorInputCapabilities.None) {
			return this.capabilities === EditorInputCapabilities.None;
		}

		return (this.capabilities & capability) !== 0;
	}

	isReadonly(): boolean | IMarkdownString {
		return this.hasCapability(EditorInputCapabilities.Readonly);
	}

	getName(): string {
		return `Editor ${this.typeId}`;
	}

	getDescription(verbosity?: Verbosity): string | undefined {
		return undefined;
	}

	getTitle(verbosity?: Verbosity): string {
		return this.getName();
	}

	getLabelExtraClasses(): string[] {
		return [];
	}

	getAriaLabel(): string {
		return this.getTitle(Verbosity.SHORT);
	}

	getIcon(): ThemeIcon | URI | undefined {
		return undefined;
	}

	getTelemetryDescriptor(): { [key: string]: unknown } {
		return { typeId: this.typeId };
	}

	isDirty(): boolean {
		return false;
	}

	isModified(): boolean {
		return this.isDirty();
	}

	isSaving(): boolean {
		return false;
	}

	async resolve(): Promise<IDisposable | null> {
		return null;
	}

	async save(group: GroupIdentifier, options?: ISaveOptions): Promise<EditorInput | IUntypedEditorInput | undefined> {
		return this;
	}

	async saveAs(group: GroupIdentifier, options?: ISaveOptions): Promise<EditorInput | IUntypedEditorInput | undefined> {
		return this;
	}

	async revert(group: GroupIdentifier, options?: IRevertOptions): Promise<void> { }

	async rename(group: GroupIdentifier, target: URI): Promise<IMoveResult | undefined> {
		return undefined;
	}

	copy(): EditorInput {
		return this;
	}

	canMove(sourceGroup: GroupIdentifier, targetGroup: GroupIdentifier): true | string {
		return true;
	}

	canReopen(): boolean {
		return true;
	}

	matches(otherInput: EditorInput | IUntypedEditorInput): boolean {

		if (isEditorInput(otherInput)) {
			return this === otherInput;
		}

		const otherInputEditorId = otherInput.options?.override;

		if (this.editorId !== otherInputEditorId && otherInputEditorId !== undefined && this.editorId !== undefined) {
			return false;
		}

		return isEqual(this.resource, EditorResourceAccessor.getCanonicalUri(otherInput));
	}

	prefersEditorPane<T extends IEditorDescriptor<IEditorPane>>(editorPanes: T[]): T | undefined {
		return editorPanes.at(0);
	}

	toUntyped(options?: IUntypedEditorOptions): IUntypedEditorInput | undefined {
		return undefined;
	}

	isDisposed(): boolean {
		return this._store.isDisposed;
	}

	override dispose(): void {
		if (!this.isDisposed()) {
			this._onWillDispose.fire();
		}

		super.dispose();
	}
}

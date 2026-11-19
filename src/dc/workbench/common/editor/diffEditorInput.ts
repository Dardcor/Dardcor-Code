/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { AbstractSideBySideEditorInputSerializer, SideBySideEditorInput } from './sideBySideEditorInput.js';
import { EditorInput, IUntypedEditorOptions } from './editorInput.js';
import { EditorModel } from './editorModel.js';
import { TEXT_DIFF_EDITOR_ID, BINARY_DIFF_EDITOR_ID, Verbosity, IEditorDescriptor, IEditorPane, IResourceDiffEditorInput, IUntypedEditorInput, isResourceDiffEditorInput, IDiffEditorInput, IResourceSideBySideEditorInput, EditorInputCapabilities } from '../editor.js';
import { BaseTextEditorModel } from './textEditorModel.js';
import { DiffEditorModel } from './diffEditorModel.js';
import { TextDiffEditorModel } from './textDiffEditorModel.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../services/editor/common/editorService.js';
import { shorten } from '../../../base/common/labels.js';
import { isResolvedEditorModel } from '../../../platform/editor/common/editor.js';

interface IDiffEditorInputLabels {
	readonly name: string;

	readonly shortDescription: string | undefined;
	readonly mediumDescription: string | undefined;
	readonly longDescription: string | undefined;

	readonly forceDescription: boolean;

	readonly shortTitle: string;
	readonly mediumTitle: string;
	readonly longTitle: string;
}

export class DiffEditorInput extends SideBySideEditorInput implements IDiffEditorInput {

	static override readonly ID: string = 'workbench.editors.diffEditorInput';

	override get typeId(): string {
		return DiffEditorInput.ID;
	}

	override get editorId(): string | undefined {
		return this.modified.editorId === this.original.editorId ? this.modified.editorId : undefined;
	}

	override get capabilities(): EditorInputCapabilities {
		let capabilities = super.capabilities;

		if (this.labels.forceDescription) {
			capabilities |= EditorInputCapabilities.ForceDescription;
		}

		return capabilities;
	}

	private cachedModel: DiffEditorModel | undefined = undefined;

	private readonly labels: IDiffEditorInputLabels;

	constructor(
		preferredName: string | undefined,
		preferredDescription: string | undefined,
		readonly original: EditorInput,
		readonly modified: EditorInput,
		private readonly forceOpenAsBinary: boolean | undefined,
		@IEditorService editorService: IEditorService
	) {
		super(preferredName, preferredDescription, original, modified, editorService);

		this.labels = this.computeLabels();
	}

	private computeLabels(): IDiffEditorInputLabels {

		let name: string;
		let forceDescription = false;
		if (this.preferredName) {
			name = this.preferredName;
		} else {
			const originalName = this.original.getName();
			const modifiedName = this.modified.getName();

			name = localize('sideBySideLabels', "{0} ↔ {1}", originalName, modifiedName);

			forceDescription = originalName === modifiedName;
		}

		let shortDescription: string | undefined;
		let mediumDescription: string | undefined;
		let longDescription: string | undefined;
		if (this.preferredDescription) {
			shortDescription = this.preferredDescription;
			mediumDescription = this.preferredDescription;
			longDescription = this.preferredDescription;
		} else {
			shortDescription = this.computeLabel(this.original.getDescription(Verbosity.SHORT), this.modified.getDescription(Verbosity.SHORT));
			longDescription = this.computeLabel(this.original.getDescription(Verbosity.LONG), this.modified.getDescription(Verbosity.LONG));

			const originalMediumDescription = this.original.getDescription(Verbosity.MEDIUM);
			const modifiedMediumDescription = this.modified.getDescription(Verbosity.MEDIUM);
			forceDescription = forceDescription
				&& !!originalMediumDescription
				&& !!modifiedMediumDescription
				&& originalMediumDescription !== modifiedMediumDescription;
			if (
				(typeof originalMediumDescription === 'string' && typeof modifiedMediumDescription === 'string') &&
				(originalMediumDescription || modifiedMediumDescription)
			) {
				const [shortenedOriginalMediumDescription, shortenedModifiedMediumDescription] = shorten([originalMediumDescription, modifiedMediumDescription]);
				mediumDescription = this.computeLabel(shortenedOriginalMediumDescription, shortenedModifiedMediumDescription);
			}
		}

		let shortTitle = this.computeLabel(this.original.getTitle(Verbosity.SHORT) ?? this.original.getName(), this.modified.getTitle(Verbosity.SHORT) ?? this.modified.getName(), ' ↔ ');
		let mediumTitle = this.computeLabel(this.original.getTitle(Verbosity.MEDIUM) ?? this.original.getName(), this.modified.getTitle(Verbosity.MEDIUM) ?? this.modified.getName(), ' ↔ ');
		let longTitle = this.computeLabel(this.original.getTitle(Verbosity.LONG) ?? this.original.getName(), this.modified.getTitle(Verbosity.LONG) ?? this.modified.getName(), ' ↔ ');

		const preferredTitle = this.getPreferredTitle();
		if (preferredTitle) {
			shortTitle = `${preferredTitle} (${shortTitle})`;
			mediumTitle = `${preferredTitle} (${mediumTitle})`;
			longTitle = `${preferredTitle} (${longTitle})`;
		}

		return { name, shortDescription, mediumDescription, longDescription, forceDescription, shortTitle, mediumTitle, longTitle };
	}

	private computeLabel(originalLabel: string, modifiedLabel: string, separator?: string): string;
	private computeLabel(originalLabel: string | undefined, modifiedLabel: string | undefined, separator?: string): string | undefined;
	private computeLabel(originalLabel: string | undefined, modifiedLabel: string | undefined, separator = ' - '): string | undefined {
		if (!originalLabel || !modifiedLabel) {
			return undefined;
		}

		if (originalLabel === modifiedLabel) {
			return modifiedLabel;
		}

		return `${originalLabel}${separator}${modifiedLabel}`;
	}

	override getName(): string {
		return this.labels.name;
	}

	override getDescription(verbosity = Verbosity.MEDIUM): string | undefined {
		switch (verbosity) {
			case Verbosity.SHORT:
				return this.labels.shortDescription;
			case Verbosity.LONG:
				return this.labels.longDescription;
			case Verbosity.MEDIUM:
			default:
				return this.labels.mediumDescription;
		}
	}

	override getTitle(verbosity?: Verbosity): string {
		switch (verbosity) {
			case Verbosity.SHORT:
				return this.labels.shortTitle;
			case Verbosity.LONG:
				return this.labels.longTitle;
			default:
			case Verbosity.MEDIUM:
				return this.labels.mediumTitle;
		}
	}

	override async resolve(): Promise<EditorModel> {

		const resolvedModel = await this.createModel();
		this.cachedModel?.dispose();

		this.cachedModel = resolvedModel;

		return this.cachedModel;
	}

	override prefersEditorPane<T extends IEditorDescriptor<IEditorPane>>(editorPanes: T[]): T | undefined {
		if (this.forceOpenAsBinary) {
			return editorPanes.find(editorPane => editorPane.typeId === BINARY_DIFF_EDITOR_ID);
		}

		return editorPanes.find(editorPane => editorPane.typeId === TEXT_DIFF_EDITOR_ID);
	}

	private async createModel(): Promise<DiffEditorModel> {

		const [originalEditorModel, modifiedEditorModel] = await Promise.all([
			this.original.resolve(),
			this.modified.resolve()
		]);

		if (modifiedEditorModel instanceof BaseTextEditorModel && originalEditorModel instanceof BaseTextEditorModel) {
			return new TextDiffEditorModel(originalEditorModel, modifiedEditorModel);
		}

		return new DiffEditorModel(isResolvedEditorModel(originalEditorModel) ? originalEditorModel : undefined, isResolvedEditorModel(modifiedEditorModel) ? modifiedEditorModel : undefined);
	}

	override toUntyped(options?: IUntypedEditorOptions): (IResourceDiffEditorInput & IResourceSideBySideEditorInput) | undefined {
		const untyped = super.toUntyped(options);
		if (untyped) {
			return {
				...untyped,
				modified: untyped.primary,
				original: untyped.secondary
			};
		}

		return undefined;
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		if (this === otherInput) {
			return true;
		}

		if (otherInput instanceof DiffEditorInput) {
			return this.modified.matches(otherInput.modified) && this.original.matches(otherInput.original) && otherInput.forceOpenAsBinary === this.forceOpenAsBinary;
		}

		if (isResourceDiffEditorInput(otherInput)) {
			return this.modified.matches(otherInput.modified) && this.original.matches(otherInput.original);
		}

		return false;
	}

	override dispose(): void {

		if (this.cachedModel) {
			this.cachedModel.dispose();
			this.cachedModel = undefined;
		}

		super.dispose();
	}
}

export class DiffEditorInputSerializer extends AbstractSideBySideEditorInputSerializer {

	protected createEditorInput(instantiationService: IInstantiationService, name: string | undefined, description: string | undefined, secondaryInput: EditorInput, primaryInput: EditorInput): EditorInput {
		return instantiationService.createInstance(DiffEditorInput, name, description, secondaryInput, primaryInput, undefined);
	}
}

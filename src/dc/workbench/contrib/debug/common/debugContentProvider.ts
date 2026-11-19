/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI as uri } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { getMimeTypes } from '../../../../editor/common/services/languagesAssociations.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { ITextModelService, ITextModelContentProvider } from '../../../../editor/common/services/resolverService.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { DEBUG_SCHEME, IDebugService, IDebugSession } from './debug.js';
import { Source } from './debugSource.js';
import { IEditorWorkerService } from '../../../../editor/common/services/editorWorker.js';
import { EditOperation } from '../../../../editor/common/core/editOperation.js';
import { Range } from '../../../../editor/common/core/range.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { PLAINTEXT_LANGUAGE_ID } from '../../../../editor/common/languages/modesRegistry.js';
import { ErrorNoTelemetry } from '../../../../base/common/errors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

export class DebugContentProvider extends Disposable implements IWorkbenchContribution, ITextModelContentProvider {

	private static INSTANCE: DebugContentProvider;

	private readonly pendingUpdates = new Map<string, CancellationTokenSource>();

	constructor(
		@ITextModelService textModelResolverService: ITextModelService,
		@IDebugService private readonly debugService: IDebugService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@IEditorWorkerService private readonly editorWorkerService: IEditorWorkerService
	) {
		super();
		this._store.add(textModelResolverService.registerTextModelContentProvider(DEBUG_SCHEME, this));
		DebugContentProvider.INSTANCE = this;
	}

	override dispose(): void {
		this.pendingUpdates.forEach(cancellationSource => cancellationSource.dispose());
		super.dispose();
	}

	provideTextContent(resource: uri): Promise<ITextModel> | null {
		return this.createOrUpdateContentModel(resource, true);
	}

	static refreshDebugContent(resource: uri): void {
		DebugContentProvider.INSTANCE?.createOrUpdateContentModel(resource, false);
	}

	private createOrUpdateContentModel(resource: uri, createIfNotExists: boolean): Promise<ITextModel> | null {

		const model = this.modelService.getModel(resource);
		if (!model && !createIfNotExists) {
			return null;
		}

		let session: IDebugSession | undefined;

		if (resource.query) {
			const data = Source.getEncodedDebugData(resource);
			session = this.debugService.getModel().getSession(data.sessionId);
		}

		if (!session) {
			session = this.debugService.getViewModel().focusedSession;
		}

		if (!session) {
			return Promise.reject(new ErrorNoTelemetry(localize('unable', "Unable to resolve the resource without a debug session")));
		}
		const createErrModel = (errMsg?: string) => {
			this.debugService.sourceIsNotAvailable(resource);
			const languageSelection = this.languageService.createById(PLAINTEXT_LANGUAGE_ID);
			const message = errMsg
				? localize('canNotResolveSourceWithError', "Could not load source '{0}': {1}.", resource.path, errMsg)
				: localize('canNotResolveSource', "Could not load source '{0}'.", resource.path);
			return this.modelService.createModel(message, languageSelection, resource);
		};

		return session.loadSource(resource).then(response => {

			if (response && response.body) {

				if (model) {

					const newContent = response.body.content;

					const cancellationSource = this.pendingUpdates.get(model.id);
					cancellationSource?.cancel();

					const myToken = new CancellationTokenSource();
					this.pendingUpdates.set(model.id, myToken);

					return this.editorWorkerService.computeMoreMinimalEdits(model.uri, [{ text: newContent, range: model.getFullModelRange() }]).then(edits => {

						this.pendingUpdates.delete(model.id);

						if (!myToken.token.isCancellationRequested && edits && edits.length > 0) {
							model.applyEdits(edits.map(edit => EditOperation.replace(Range.lift(edit.range), edit.text)));
						}
						return model;
					});
				} else {
					const mime = response.body.mimeType || getMimeTypes(resource)[0];
					const languageSelection = this.languageService.createByMimeType(mime);
					return this.modelService.createModel(response.body.content, languageSelection, resource);
				}
			}

			return createErrModel();

		}, (err: DebugProtocol.ErrorResponse) => createErrModel(err.message));
	}
}

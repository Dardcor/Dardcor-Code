/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { DocumentId } from '../../../../../platform/inlineEdits/common/dataTypes/documentId';
import { IObservableDocument } from '../../../../../platform/inlineEdits/common/observableWorkspace';
import { IObservableWithChange } from '../../../../../util/dardcor/base/common/observableInternal';
import { URI } from '../../../../../util/dardcor/base/common/uri';
import { createDecorator as createServiceIdentifier } from '../../../../../util/dardcor/platform/instantiation/common/instantiation';

export const ICompletionsObservableWorkspace = createServiceIdentifier<ICompletionsObservableWorkspace>('ICompletionsObservableWorkspace');
export interface ICompletionsObservableWorkspace {
	readonly _serviceBrand: undefined;

	get openDocuments(): IObservableWithChange<readonly IObservableDocument[], { added: readonly IObservableDocument[]; removed: readonly IObservableDocument[] }>;

	getWorkspaceRoot(documentId: DocumentId): URI | undefined;

	getFirstOpenDocument(): IObservableDocument | undefined;

	getDocument(documentId: DocumentId): IObservableDocument | undefined;
}

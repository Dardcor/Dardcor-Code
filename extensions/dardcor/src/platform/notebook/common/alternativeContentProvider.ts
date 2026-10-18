/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, NotebookCell, NotebookDocument } from 'vscode';
import { Uri } from '../../../dardcorTypes';
import { AlternativeNotebookDocument } from './alternativeNotebookDocument';
import { LineOfCellText, LineOfText } from './helpers';


export abstract class BaseAlternativeNotebookContentProvider {
	constructor(public readonly kind: 'xml' | 'text' | 'json') { }

	public abstract stripCellMarkers(text: string): string;

	public abstract getAlternativeDocument(notebook: NotebookDocument, excludeMarkdownCells?: boolean): AlternativeNotebookDocument;

	public abstract getAlternativeDocumentFromText(text: string, notebook: NotebookDocument): AlternativeNotebookDocument;

	public abstract getSummaryOfStructure(notebook: NotebookDocument, cellsToInclude: NotebookCell[], existingCodeMarker: string): string;

	public abstract parseAlternateContent(notebookOrUri: NotebookDocument | Uri, inputStream: AsyncIterable<LineOfText>, token: CancellationToken): AsyncIterable<LineOfCellText>;

}

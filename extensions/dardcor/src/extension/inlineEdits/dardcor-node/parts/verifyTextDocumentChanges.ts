/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EndOfLine, TextDocument, TextDocumentChangeEvent, workspace } from 'vscode';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry';
import { Disposable } from '../../../../util/dardcor/base/common/lifecycle';
import { editFromTextDocumentContentChangeEvents } from './common';

export class VerifyTextDocumentChanges extends Disposable {
	private readonly _documentStates = new Map<string, { text: string; linefeed: EndOfLine }>();

	constructor(
		@ITelemetryService private readonly _telemetryService: ITelemetryService
	) {
		super();

		const allowedSchemes = new Set([
			'file',
			'vscode-notebook-cell',
			'untitled',
		]);
		function shouldVerifyDoc(doc: TextDocument): boolean {
			return allowedSchemes.has(doc.uri.scheme);
		}

		this._register(workspace.onDidOpenTextDocument(doc => {
			if (!shouldVerifyDoc(doc)) {
				return;
			}
			const docUri = doc.uri.toString();
			this._documentStates.set(docUri, { text: doc.getText(), linefeed: doc.eol });
		}));

		this._register(workspace.onDidCloseTextDocument(doc => {
			if (!shouldVerifyDoc(doc)) {
				return;
			}
			const docUri = doc.uri.toString();
			this._documentStates.delete(docUri);
		}));

		workspace.textDocuments.forEach(doc => {
			if (!shouldVerifyDoc(doc)) {
				return;
			}
			const docUri = doc.uri.toString();
			this._documentStates.set(docUri, { text: doc.getText(), linefeed: doc.eol });
		});

		this._register(workspace.onDidChangeTextDocument(e => {
			if (!shouldVerifyDoc(e.document)) {
				return;
			}
			this._verifyDocumentStateConsistency(e);
		}));
	}

	private _verifyDocumentStateConsistency(e: TextDocumentChangeEvent): void {
		const docUri = e.document.uri.toString();
		const currentText = e.document.getText();
		const previousValue = this._documentStates.get(docUri);

		if (previousValue === undefined) {
			this._telemetryService.sendMSFTTelemetryEvent('vscode.contentChangeForUnknownDocument', {}, {});
			return;
		}

		this._documentStates.set(docUri, { text: currentText, linefeed: e.document.eol });

		const edit = editFromTextDocumentContentChangeEvents(e.contentChanges);
		const expectedText = edit.apply(previousValue.text);

		if (expectedText !== currentText) {
			this._telemetryService.sendMSFTTelemetryEvent('vscode.contentChangeInconsistencyDetected', {
				languageId: e.document.languageId,
				scheme: e.document.uri.scheme,
				sourceOfChange: e.detailedReason?.source || '',
			}, {
				reason: e.reason,
				previousLineFeed: previousValue.linefeed,
				currentLineFeed: e.document.eol,
			});
		}
	}
}

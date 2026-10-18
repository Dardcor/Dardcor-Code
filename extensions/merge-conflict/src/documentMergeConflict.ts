/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as interfaces from './interfaces';
import * as vscode from 'vscode';
import type TelemetryReporter from '@vscode/extension-telemetry';

export class DocumentMergeConflict implements interfaces.IDocumentMergeConflict {

	public range: vscode.Range;
	public current: interfaces.IMergeRegion;
	public incoming: interfaces.IMergeRegion;
	public commonAncestors: interfaces.IMergeRegion[];
	public splitter: vscode.Range;
	private applied = false;

	constructor(descriptor: interfaces.IDocumentMergeConflictDescriptor, private readonly telemetryReporter: TelemetryReporter) {
		this.range = descriptor.range;
		this.current = descriptor.current;
		this.incoming = descriptor.incoming;
		this.commonAncestors = descriptor.commonAncestors;
		this.splitter = descriptor.splitter;
	}

	public commitEdit(type: interfaces.CommitType, editor: vscode.TextEditor, edit?: vscode.TextEditorEdit): Thenable<boolean> {
		function commitTypeToString(type: interfaces.CommitType): string {
			switch (type) {
				case interfaces.CommitType.Current:
					return 'current';
				case interfaces.CommitType.Incoming:
					return 'incoming';
				case interfaces.CommitType.Both:
					return 'both';
			}
		}

		this.telemetryReporter.sendTelemetryEvent('mergeMarkers.accept', { resolution: commitTypeToString(type) });

		if (edit) {

			this.applyEdit(type, editor.document, edit);
			return Promise.resolve(true);
		}

		return editor.edit((edit) => this.applyEdit(type, editor.document, edit));
	}

	public applyEdit(type: interfaces.CommitType, document: vscode.TextDocument, edit: { replace(range: vscode.Range, newText: string): void }): void {
		if (this.applied) {
			return;
		}
		this.applied = true;

		if (type === interfaces.CommitType.Current) {
			const content = document.getText(this.current.content);
			this.replaceRangeWithContent(content, edit);
		}
		else if (type === interfaces.CommitType.Incoming) {
			const content = document.getText(this.incoming.content);
			this.replaceRangeWithContent(content, edit);
		}
		else if (type === interfaces.CommitType.Both) {

			const currentContent = document.getText(this.current.content);
			const incomingContent = document.getText(this.incoming.content);

			edit.replace(this.range, currentContent.concat(incomingContent));
		}
	}

	private replaceRangeWithContent(content: string, edit: { replace(range: vscode.Range, newText: string): void }) {
		if (this.isNewlineOnly(content)) {
			edit.replace(this.range, '');
			return;
		}

		edit.replace(this.range, content);
	}

	private isNewlineOnly(text: string) {
		return text === '\n' || text === '\r\n';
	}
}

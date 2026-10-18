/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from '../util/dispose';
import { MdLinkOpener } from '../util/openDocumentLink';
import { getMarkdownLocalResourceRoots } from '../util/resources';

export class MarkdownEditorProvider extends Disposable implements vscode.CustomTextEditorProvider {

	public static readonly viewType = 'vscode.markdown.editor';

	/**
	 * Memento key under which the last chosen edit/read-only mode is remembered.
	 * The value is a single global default shared by every Markdown editor, so
	 * flipping the lock in one editor becomes the initial mode for the next.
	 */
	static readonly #readonlyStateKey = 'markdown.editor.readonly';

	readonly #mediaRoot: vscode.Uri;
	readonly #extensionUri: vscode.Uri;
	readonly #globalState: vscode.Memento;
	readonly #linkOpener: MdLinkOpener;

	constructor(extensionUri: vscode.Uri, globalState: vscode.Memento, linkOpener: MdLinkOpener) {
		super();
		this.#extensionUri = extensionUri;
		this.#globalState = globalState;
		this.#linkOpener = linkOpener;
		this.#mediaRoot = vscode.Uri.joinPath(this.#extensionUri, 'markdown-editor-out');
	}

	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		token: vscode.CancellationToken,
	): Promise<void> {
		if (!vscode.workspace.isTrusted) {
			const cancel = { title: vscode.l10n.t("Cancel"), isCloseAffordance: true };
			const openAnyway = { title: vscode.l10n.t("Open Anyway") };
			const choice = await vscode.window.showWarningMessage(
				vscode.l10n.t("This Markdown file is in an untrusted workspace. Do you want to open it anyway?"),
				{
					modal: true,
					detail: vscode.l10n.t("For your security, only continue if you trust the source of this Markdown file."),
				},
				cancel,
				openAnyway,
			);
			if (choice !== openAnyway || token.isCancellationRequested) {
				webviewPanel.dispose();
				return;
			}
		}

		const webview = webviewPanel.webview;
		this.#configureWebview(document.uri, webview);
		this.#wireSingle(document, webviewPanel);
	}

	#configureWebview(documentUri: vscode.Uri, webview: vscode.Webview): void {
		webview.options = {
			enableScripts: true,
			localResourceRoots: getMarkdownLocalResourceRoots(documentUri, [this.#mediaRoot], {
				includeWorkspaceResources: vscode.workspace.isTrusted,
			}),
		};
		webview.html = this.#getHtml(documentUri, webview);
	}

	#wireSingle(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): void {
		const webview = webviewPanel.webview;
		let isUpdatingFromWebview = false;
		let editQueue = Promise.resolve();

		const onMessage = webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case 'ready': {
					webview.postMessage({ type: 'init', content: document.getText(), readonly: this.#globalState.get(MarkdownEditorProvider.#readonlyStateKey, true) });
					break;
				}
				case 'setReadonly': {
					// Remember the edit/read-only choice as the global default for the
					await this.#globalState.update(MarkdownEditorProvider.#readonlyStateKey, !!message.readonly);
					break;
				}
				case 'openLink': {
					await this.#linkOpener.openDocumentLink(message.href as string, document.uri);
					break;
				}
				case 'edit': {
					editQueue = editQueue.then(async () => {
						const edit = new vscode.WorkspaceEdit();
						edit.replace(
							document.uri,
							new vscode.Range(
								document.positionAt(message.start),
								document.positionAt(message.endExclusive),
							),
							message.text,
						);
						isUpdatingFromWebview = true;
						try {
							await vscode.workspace.applyEdit(edit);
						} finally {
							isUpdatingFromWebview = false;
						}
					});
					await editQueue;
					break;
				}
			}
		});

		const onDocumentChange = vscode.workspace.onDidChangeTextDocument((e) => {
			if (e.document.uri.toString() !== document.uri.toString() || isUpdatingFromWebview) {
				return;
			}
			webview.postMessage({ type: 'update', content: document.getText() });
		});

		const highlight = this.#wireHighlight(webview);
		const quickDiff = this.#wireQuickDiff(document, webview);
		const comments = this.#wireComments(document, webview);
		const onDidGrantWorkspaceTrust = vscode.workspace.onDidGrantWorkspaceTrust(() => {
			this.#configureWebview(document.uri, webview);
		});

		webviewPanel.onDidDispose(() => {
			onMessage.dispose();
			onDocumentChange.dispose();
			highlight.dispose();
			quickDiff.dispose();
			comments.dispose();
			onDidGrantWorkspaceTrust.dispose();
		});
	}

	#wireQuickDiff(document: vscode.TextDocument, webview: vscode.Webview): vscode.Disposable {
		const diffProvider = vscode.window.createSourceControlDiffInformation(document.uri);

		const postMarkers = () => {
			const diffInformation = diffProvider.diffInformation;
			if (!diffInformation || diffInformation.isStale) {
				return;
			}
			webview.postMessage({ type: 'gutterMarkers', markers: toGutterMarkers(document, diffInformation.changes) });
		};

		const onChange = diffProvider.onDidChange(postMarkers);
		const onMessage = webview.onDidReceiveMessage((message) => {
			if (message.type === 'ready') {
				postMarkers();
			}
		});
		const onDocumentChange = vscode.workspace.onDidChangeTextDocument((e) => {
			if (e.document.uri.toString() === document.uri.toString()) {
				postMarkers();
			}
		});

		return vscode.Disposable.from(diffProvider, onChange, onMessage, onDocumentChange);
	}

	#wireComments(document: vscode.TextDocument, webview: vscode.Webview): vscode.Disposable {
		const commentsProvider = vscode.window.createAgentEditorComments(document.uri);
		let webviewReady = false;
		let revealedCommentId: string | undefined;

		const postComments = () => {
			const comments = commentsProvider.comments.map(comment => ({
				id: comment.id,
				start: document.offsetAt(comment.range.start),
				endExclusive: document.offsetAt(comment.range.end),
				body: comment.body,
				author: comment.author,
			}));
			webview.postMessage({ type: 'comments', comments, acceptsComments: commentsProvider.acceptsComments });
		};
		const postReveal = () => {
			if (webviewReady && revealedCommentId) {
				webview.postMessage({ type: 'revealComment', id: revealedCommentId });
			}
		};

		const onChange = commentsProvider.onDidChange(postComments);
		const onDidRevealComment = commentsProvider.onDidRevealComment(id => {
			revealedCommentId = id;
			postReveal();
		});
		const onMessage = webview.onDidReceiveMessage((message) => {
			if (message.type === 'ready') {
				webviewReady = true;
				postComments();
				postReveal();
			} else if (message.type === 'addComment') {
				const range = new vscode.Range(
					document.positionAt(message.start),
					document.positionAt(message.endExclusive),
				);
				commentsProvider.addComment(range, message.text);
			} else if (message.type === 'deleteComment') {
				commentsProvider.deleteComment(message.id);
			}
		});

		return vscode.Disposable.from(commentsProvider, onChange, onDidRevealComment, onMessage);
	}


	#wireHighlight(webview: vscode.Webview): vscode.Disposable {
		const onMessage = webview.onDidReceiveMessage(async (message) => {
			if (message.type !== 'highlight') {
				return;
			}
			const result = await vscode.languages.computeFullSyntaxHighlighting(message.source, message.languageId);
			webview.postMessage({
				type: 'highlightResult',
				requestId: message.requestId,
				tokens: result.tokens,
				colorMap: result.colorMap,
			});
		});

		const onThemeChange = vscode.languages.onDidChangeSyntaxHighlighting(() => {
			webview.postMessage({ type: 'highlightThemeChanged' });
		});

		return vscode.Disposable.from(onMessage, onThemeChange);
	}

	#getHtml(documentUri: vscode.Uri, webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.#mediaRoot, 'editor.js'));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.#mediaRoot, 'editor.css'));
		const baseUri = webview.asWebviewUri(documentUri);
		const nonce = getNonce();

		const body = `
	<div id="editor"></div>`;

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} https: data:; media-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';" />
	<base href="${baseUri}" />
	<link rel="stylesheet" href="${styleUri}" />
	<title>Markdown Editor</title>
</head>
<body>${body}
	<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

interface GutterMarkerMessage {
	readonly start: number;
	readonly endExclusive: number;
	readonly type: 'added' | 'modified' | 'deleted';
}

function toGutterMarkers(document: vscode.TextDocument, changes: readonly vscode.TextEditorChange[]): GutterMarkerMessage[] {
	const markers: GutterMarkerMessage[] = [];
	for (const change of changes) {
		if (change.kind === vscode.TextEditorChangeKind.Deletion) {
			const line = Math.max(0, change.modified.startLineNumber - 1);
			const offset = document.offsetAt(new vscode.Position(line, 0));
			markers.push({ start: offset, endExclusive: offset, type: 'deleted' });
			continue;
		}

		const start = document.offsetAt(new vscode.Position(change.modified.startLineNumber - 1, 0));
		const endExclusive = document.offsetAt(document.lineAt(change.modified.endLineNumberExclusive - 2).range.end);
		markers.push({
			start,
			endExclusive,
			type: change.kind === vscode.TextEditorChangeKind.Addition ? 'added' : 'modified',
		});
	}
	return markers;
}

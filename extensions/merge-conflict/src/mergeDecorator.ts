/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as interfaces from './interfaces';


export default class MergeDecorator implements vscode.Disposable {

	private decorations: { [key: string]: vscode.TextEditorDecorationType } = {};

	private decorationUsesWholeLine: boolean = true;

	private config?: interfaces.IExtensionConfiguration;
	private tracker: interfaces.IDocumentMergeConflictTracker;
	private updating = new Map<vscode.TextEditor, boolean>();

	constructor(private context: vscode.ExtensionContext, trackerService: interfaces.IDocumentMergeConflictTrackerService) {
		this.tracker = trackerService.createTracker('decorator');
	}

	begin(config: interfaces.IExtensionConfiguration) {
		this.config = config;
		this.registerDecorationTypes(config);

		vscode.window.visibleTextEditors.forEach(e => this.applyDecorations(e));

		vscode.workspace.onDidOpenTextDocument(event => {
			this.applyDecorationsFromEvent(event);
		}, null, this.context.subscriptions);

		vscode.workspace.onDidChangeTextDocument(event => {
			this.applyDecorationsFromEvent(event.document);
		}, null, this.context.subscriptions);

		vscode.window.onDidChangeVisibleTextEditors((e) => {
			e.forEach(e => this.applyDecorations(e));
		}, null, this.context.subscriptions);
	}

	configurationUpdated(config: interfaces.IExtensionConfiguration) {
		this.config = config;
		this.registerDecorationTypes(config);

		vscode.window.visibleTextEditors.forEach(e => {
			this.removeDecorations(e);
			this.applyDecorations(e);
		});
	}

	private registerDecorationTypes(config: interfaces.IExtensionConfiguration) {

		Object.keys(this.decorations).forEach(k => this.decorations[k].dispose());
		this.decorations = {};

		if (!config.enableDecorations || !config.enableEditorOverview) {
			return;
		}

		if (config.enableDecorations || config.enableEditorOverview) {
			this.decorations['current.content'] = vscode.window.createTextEditorDecorationType(
				this.generateBlockRenderOptions('merge.currentContentBackground', 'editorOverviewRuler.currentContentForeground', config)
			);

			this.decorations['incoming.content'] = vscode.window.createTextEditorDecorationType(
				this.generateBlockRenderOptions('merge.incomingContentBackground', 'editorOverviewRuler.incomingContentForeground', config)
			);

			this.decorations['commonAncestors.content'] = vscode.window.createTextEditorDecorationType(
				this.generateBlockRenderOptions('merge.commonContentBackground', 'editorOverviewRuler.commonContentForeground', config)
			);
		}

		if (config.enableDecorations) {
			this.decorations['current.header'] = vscode.window.createTextEditorDecorationType({
				isWholeLine: this.decorationUsesWholeLine,
				backgroundColor: new vscode.ThemeColor('merge.currentHeaderBackground'),
				color: new vscode.ThemeColor('editor.foreground'),
				outlineStyle: 'solid',
				outlineWidth: '1pt',
				outlineColor: new vscode.ThemeColor('merge.border'),
				after: {
					contentText: ' ' + vscode.l10n.t("(Current Change)"),
					color: new vscode.ThemeColor('descriptionForeground')
				}
			});

			this.decorations['commonAncestors.header'] = vscode.window.createTextEditorDecorationType({
				isWholeLine: this.decorationUsesWholeLine,
				backgroundColor: new vscode.ThemeColor('merge.commonHeaderBackground'),
				color: new vscode.ThemeColor('editor.foreground'),
				outlineStyle: 'solid',
				outlineWidth: '1pt',
				outlineColor: new vscode.ThemeColor('merge.border')
			});

			this.decorations['splitter'] = vscode.window.createTextEditorDecorationType({
				color: new vscode.ThemeColor('editor.foreground'),
				outlineStyle: 'solid',
				outlineWidth: '1pt',
				outlineColor: new vscode.ThemeColor('merge.border'),
				isWholeLine: this.decorationUsesWholeLine,
			});

			this.decorations['incoming.header'] = vscode.window.createTextEditorDecorationType({
				backgroundColor: new vscode.ThemeColor('merge.incomingHeaderBackground'),
				color: new vscode.ThemeColor('editor.foreground'),
				outlineStyle: 'solid',
				outlineWidth: '1pt',
				outlineColor: new vscode.ThemeColor('merge.border'),
				isWholeLine: this.decorationUsesWholeLine,
				after: {
					contentText: ' ' + vscode.l10n.t("(Incoming Change)"),
					color: new vscode.ThemeColor('descriptionForeground')
				}
			});
		}
	}

	dispose() {

		Object.keys(this.decorations).forEach(name => {
			this.decorations[name].dispose();
		});

		this.decorations = {};
	}

	private generateBlockRenderOptions(backgroundColor: string, overviewRulerColor: string, config: interfaces.IExtensionConfiguration): vscode.DecorationRenderOptions {

		const renderOptions: vscode.DecorationRenderOptions = {};

		if (config.enableDecorations) {
			renderOptions.backgroundColor = new vscode.ThemeColor(backgroundColor);
			renderOptions.isWholeLine = this.decorationUsesWholeLine;
		}

		if (config.enableEditorOverview) {
			renderOptions.overviewRulerColor = new vscode.ThemeColor(overviewRulerColor);
			renderOptions.overviewRulerLane = vscode.OverviewRulerLane.Full;
		}

		return renderOptions;
	}

	private applyDecorationsFromEvent(eventDocument: vscode.TextDocument) {
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document === eventDocument) {
				this.applyDecorations(editor);
			}
		}
	}

	private async applyDecorations(editor: vscode.TextEditor) {
		if (!editor || !editor.document) { return; }

		if (!this.config || (!this.config.enableDecorations && !this.config.enableEditorOverview)) {
			return;
		}

		if (this.updating.get(editor)) {
			return;
		}

		try {
			this.updating.set(editor, true);

			const conflicts = await this.tracker.getConflicts(editor.document);
			if (vscode.window.visibleTextEditors.indexOf(editor) === -1) {
				return;
			}

			if (conflicts.length === 0) {
				this.removeDecorations(editor);
				return;
			}

			const matchDecorations: { [key: string]: vscode.Range[] } = {};

			const pushDecoration = (key: string, d: vscode.Range) => {
				matchDecorations[key] = matchDecorations[key] || [];
				matchDecorations[key].push(d);
			};

			conflicts.forEach(conflict => {
				if (!conflict.current.decoratorContent.isEmpty) {
					pushDecoration('current.content', conflict.current.decoratorContent);
				}
				if (!conflict.incoming.decoratorContent.isEmpty) {
					pushDecoration('incoming.content', conflict.incoming.decoratorContent);
				}

				conflict.commonAncestors.forEach(commonAncestorsRegion => {
					if (!commonAncestorsRegion.decoratorContent.isEmpty) {
						pushDecoration('commonAncestors.content', commonAncestorsRegion.decoratorContent);
					}
				});

				if (this.config!.enableDecorations) {
					pushDecoration('current.header', conflict.current.header);
					pushDecoration('splitter', conflict.splitter);
					pushDecoration('incoming.header', conflict.incoming.header);

					conflict.commonAncestors.forEach(commonAncestorsRegion => {
						pushDecoration('commonAncestors.header', commonAncestorsRegion.header);
					});
				}
			});

			Object.keys(matchDecorations).forEach(decorationKey => {
				const decorationType = this.decorations[decorationKey];

				if (decorationType) {
					editor.setDecorations(decorationType, matchDecorations[decorationKey]);
				}
			});

		} finally {
			this.updating.delete(editor);
		}
	}

	private removeDecorations(editor: vscode.TextEditor) {
		Object.keys(this.decorations).forEach(decorationKey => {

			const decorationType = this.decorations[decorationKey];

			if (decorationType) {
				editor.setDecorations(decorationType, []);
			}
		});
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type { Selection, TextEditor, Uri } from 'vscode';
import { IDiffService } from '../../../platform/diff/common/diffService';
import { TextDocumentSnapshot } from '../../../platform/editing/common/textDocumentSnapshot';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { FileType } from '../../../platform/filesystem/common/fileTypes';
import { IGitExtensionService } from '../../../platform/git/common/gitExtensionService';
import { ILogService } from '../../../platform/log/common/logService';
import { INotificationService, Progress, ProgressLocation } from '../../../platform/notification/common/notificationService';
import { CodeReviewInput, CodeReviewResult, toCodeReviewResult } from '../../../platform/review/common/reviewCommand';
import { IReviewService, ReviewComment } from '../../../platform/review/common/reviewService';
import { IScopeSelector } from '../../../platform/scopeSelection/common/scopeSelection';
import { ITabsAndEditorsService } from '../../../platform/tabs/common/tabsAndEditorsService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { CancellationToken, CancellationTokenSource } from '../../../util/dardcor/base/common/cancellation';
import { isCancellationError } from '../../../util/dardcor/base/common/errors';
import * as path from '../../../util/dardcor/base/common/path';
import { URI } from '../../../util/dardcor/base/common/uri';
import { IInstantiationService, ServicesAccessor } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { Range } from '../../../dardcorTypes';
import { FeedbackGenerator, FeedbackResult } from '../../prompt/node/feedbackGenerator';
import { CurrentChange, CurrentChangeInput } from '../../prompts/node/feedback/currentChange';

export interface HandleResultDependencies {
	notificationService: INotificationService;
	logService: ILogService;
	reviewService: IReviewService;
}

export async function handleReviewResult(
	result: FeedbackResult,
	deps: HandleResultDependencies
): Promise<void> {
	const { notificationService, logService, reviewService } = deps;

	if (result.type === 'error') {
		const showLog = l10n.t('Show Log');
		const res = await (result.severity === 'info'
			? notificationService.showInformationMessage(result.reason, { modal: true })
			: notificationService.showInformationMessage(
				l10n.t('Code review generation failed.'),
				{ modal: true, detail: result.reason },
				showLog
			)
		);
		if (res === showLog) {
			logService.show();
		}
	} else if (result.type === 'success' && result.comments.length === 0) {
		if (result.excludedComments?.length) {
			const show = l10n.t('Show Skipped');
			const res = await notificationService.showInformationMessage(
				l10n.t('Reviewing your code did not provide any feedback.'),
				{
					modal: true,
					detail: l10n.t('{0} comments were skipped due to low confidence.', result.excludedComments.length)
				},
				show
			);
			if (res === show) {
				reviewService.addReviewComments(result.excludedComments);
			}
		} else {
			await notificationService.showInformationMessage(
				l10n.t('Reviewing your code did not provide any feedback.'),
				{
					modal: true,
					detail: result.reason || l10n.t('Dardcor only keeps its highest confidence comments to reduce noise and keep you focused.')
				}
			);
		}
	}
}

let inProgress: CancellationTokenSource | undefined;

export class ReviewSession {

	constructor(
		@IScopeSelector private readonly scopeSelector: IScopeSelector,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IReviewService private readonly reviewService: IReviewService,
		@ILogService private readonly logService: ILogService,
		@IGitExtensionService private readonly gitExtensionService: IGitExtensionService,
		@ITabsAndEditorsService private readonly tabsAndEditorsService: ITabsAndEditorsService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@INotificationService private readonly notificationService: INotificationService,
	) { }

	async review(
		group: ReviewGroup,
		progressLocation: ProgressLocation,
		cancellationToken?: CancellationToken
	): Promise<FeedbackResult | undefined> {
		if (cancellationToken?.isCancellationRequested) {
			return { type: 'cancelled' };
		}
		const editor = this.tabsAndEditorsService.activeTextEditor;
		const selection = await this.resolveSelection(group, editor);
		if (group === 'selection' && selection === undefined) {
			return undefined;
		}

		const title = getReviewTitle(group, editor);
		return this.executeWithProgress(group, editor, selection, title, progressLocation, cancellationToken);
	}

	private async resolveSelection(group: ReviewGroup, editor: TextEditor | undefined): Promise<Selection | undefined> {
		if (group !== 'selection') {
			return editor?.selection;
		}
		if (!editor) {
			return undefined;
		}
		let selection = editor.selection;
		if (!selection || selection.isEmpty) {
			try {
				const rangeOfEnclosingSymbol = await this.scopeSelector.selectEnclosingScope(editor, {
					reason: l10n.t('Select an enclosing range to review'),
					includeBlocks: true
				});
				if (!rangeOfEnclosingSymbol) {
					return undefined;
				}
				selection = rangeOfEnclosingSymbol;
			} catch (err) {
				if (isCancellationError(err)) {
					return undefined;
				}
			}
		}
		return selection;
	}

	private async executeWithProgress(
		group: ReviewGroup,
		editor: TextEditor | undefined,
		selection: Selection | undefined,
		title: string,
		progressLocation: ProgressLocation,
		cancellationToken?: CancellationToken
	): Promise<FeedbackResult | undefined> {
		return this.notificationService.withProgress({
			location: progressLocation,
			title,
			cancellable: true,
		}, async (_progress, progressToken) => {
			if (inProgress) {
				inProgress.cancel();
			}
			const tokenSource = inProgress = new CancellationTokenSource();
			const cancel = () => tokenSource.cancel();
			const cancellationSubscriptions = [progressToken.onCancellationRequested(cancel)];
			if (cancellationToken) {
				cancellationSubscriptions.push(cancellationToken.onCancellationRequested(cancel));
			}

			try {
				this.reviewService.removeReviewComments(this.reviewService.getReviewComments());
				const progress: Progress<ReviewComment[]> = {
					report: comments => {
						if (!tokenSource.token.isCancellationRequested) {
							this.reviewService.addReviewComments(comments);
						}
					}
				};

				const result = await this.performReview(group, editor, selection, progress, tokenSource);

				if (tokenSource.token.isCancellationRequested) {
					return { type: 'cancelled' };
				}

				await this.handleResult(result);
				return result;
			} finally {
				for (const subscription of cancellationSubscriptions) {
					subscription.dispose();
				}
				if (inProgress === tokenSource) {
					inProgress = undefined;
				}
				tokenSource.dispose();
			}
		});
	}

	private async performReview(
		group: ReviewGroup,
		editor: TextEditor | undefined,
		selection: Selection | undefined,
		progress: Progress<ReviewComment[]>,
		tokenSource: CancellationTokenSource
	): Promise<FeedbackResult> {
		try {
			return await review(
				this.instantiationService, this.gitExtensionService, this.workspaceService,
				group, editor, selection, progress, tokenSource.token
			);
		} catch (err) {
			this.logService.error(err, 'Error during code review');
			return { type: 'error', reason: err.message, severity: err.severity };
		}
	}

	private async handleResult(result: FeedbackResult): Promise<void> {
		return handleReviewResult(result, {
			notificationService: this.notificationService,
			logService: this.logService,
			reviewService: this.reviewService,
		});
	}
}

export type ReviewGroup = 'selection' | 'index' | 'workingTree' | 'all' | { group: 'index' | 'workingTree'; file: Uri } | { repositoryRoot: string; commitMessages: string[]; patches: { patch: string; fileUri: string; previousFileUri?: string }[] };

export function getReviewTitle(group: ReviewGroup, editor?: TextEditor): string {
	if (group === 'selection') {
		return l10n.t('Reviewing selected code in {0}...', path.posix.basename(editor!.document.uri.path));
	}
	if (group === 'index') {
		return l10n.t('Reviewing staged changes...');
	}
	if (group === 'workingTree') {
		return l10n.t('Reviewing unstaged changes...');
	}
	if (group === 'all') {
		return l10n.t('Reviewing uncommitted changes...');
	}
	if ('repositoryRoot' in group) {
		return l10n.t('Reviewing changes...');
	}
	if (group.group === 'index') {
		return l10n.t('Reviewing staged changes in {0}...', path.posix.basename(group.file.path));
	}
	return l10n.t('Reviewing unstaged changes in {0}...', path.posix.basename(group.file.path));
}

export function combineCancellationTokens(token1: CancellationToken, token2: CancellationToken): CancellationToken {
	const combinedSource = new CancellationTokenSource();

	const subscription1 = token1.onCancellationRequested(() => {
		combinedSource.cancel();
		cleanup();
	});

	const subscription2 = token2.onCancellationRequested(() => {
		combinedSource.cancel();
		cleanup();
	});

	function cleanup() {
		subscription1.dispose();
		subscription2.dispose();
	}

	return combinedSource.token;
}

async function review(
	instantiationService: IInstantiationService,
	gitExtensionService: IGitExtensionService,
	workspaceService: IWorkspaceService,
	group: ReviewGroup,
	editor: TextEditor | undefined,
	selection: Selection | undefined,
	progress: Progress<ReviewComment[]>,
	cancellationToken: CancellationToken
) {
	const feedbackGenerator = instantiationService.createInstance(FeedbackGenerator);
	const input: CurrentChangeInput[] = [];
	if (group === 'index' || group === 'workingTree' || group === 'all') {
		const changes = await CurrentChange.getCurrentChanges(gitExtensionService, group);
		const documentsAndChanges = await Promise.all<CurrentChangeInput | undefined>(changes.map(async (change) => {
			try {
				const document = await workspaceService.openTextDocument(change.uri);
				return {
					document: TextDocumentSnapshot.create(document),
					relativeDocumentPath: change.repository
						? path.relative(change.repository.rootUri.fsPath, change.uri.fsPath)
						: workspaceService.asRelativePath(change.uri),
					change,
				};
			} catch (err) {
				try {
					if ((await workspaceService.fs.stat(change.uri)).type === FileType.File) {
						throw err;
					}
					return undefined;
				} catch (inner) {
					if (inner.code === 'FileNotFound') {
						return undefined;
					}
					throw err;
				}
			}
		}));
		documentsAndChanges.map(i => {
			if (i) {
				input.push(i);
			}
		});
	} else if (group === 'selection') {
		input.push({
			document: TextDocumentSnapshot.create(editor!.document),
			relativeDocumentPath: path.basename(editor!.document.uri.fsPath),
			selection: selection!,
		});
	} else if ('file' in group) {
		const repository = gitExtensionService.getExtensionApi()?.getRepository(group.file);
		if (repository) {
			const diff = await (group.group === 'index'
				? repository.diffIndexWithHEAD(group.file.fsPath)
				: repository.diffWithHEAD(group.file.fsPath));
			if (diff) {
				const change = await CurrentChange.getChanges(gitExtensionService, repository.rootUri, group.file, diff);
				if (change) {
					input.push({
						document: await workspaceService.openTextDocumentAndSnapshot(group.file),
						relativeDocumentPath: path.relative(repository.rootUri.fsPath, group.file.fsPath),
						change,
					});
				}
			}
		}
	} else if ('repositoryRoot' in group) {
		for (const patch of group.patches) {
			const uri = URI.parse(patch.fileUri);
			input.push({
				document: TextDocumentSnapshot.create(await workspaceService.openTextDocument(uri)),
				relativeDocumentPath: path.relative(group.repositoryRoot, uri.fsPath),
				change: await CurrentChange.getChanges(gitExtensionService, URI.file(group.repositoryRoot), uri, patch.patch)
			});
		}
	}
	return feedbackGenerator.generateComments(input, cancellationToken, progress);
}

export async function reviewFileChanges(
	accessor: ServicesAccessor,
	input: CodeReviewInput,
): Promise<CodeReviewResult> {
	const logService = accessor.get(ILogService);
	const diffService = accessor.get(IDiffService);
	const workspaceService = accessor.get(IWorkspaceService);
	const fileSystemService = accessor.get(IFileSystemService);
	const instantiationService = accessor.get(IInstantiationService);

	const tokenSource = new CancellationTokenSource();
	try {
		const fileInputs = await Promise.all(input.files.map(async file => {
			let baseContent: string;
			if (file.baseUri) {
				const bytes = await fileSystemService.readFile(file.baseUri);
				baseContent = new TextDecoder().decode(bytes);
			} else {
				baseContent = '';
			}

			const document = TextDocumentSnapshot.create(await workspaceService.openTextDocument(file.currentUri));
			const currentContent = document.getText();
			const diff = await diffService.computeDiff(baseContent, currentContent, {
				computeMoves: false,
				ignoreTrimWhitespace: false,
				maxComputationTimeMs: 5_000,
			});
			if (diff.quitEarly) {
				throw new Error(`Could not compute a complete diff for ${workspaceService.asRelativePath(file.currentUri)}.`);
			}

			const originalLines = baseContent.split(/\r\n|\r|\n/);
			const currentLines = currentContent.split(/\r\n|\r|\n/);
			const hunks = diff.changes
				.filter(change => !change.original.isEmpty || !change.modified.isEmpty)
				.map(change => {
					const removedLines = originalLines.slice(change.original.startLineNumber - 1, change.original.endLineNumberExclusive - 1);
					const addedLines = currentLines.slice(change.modified.startLineNumber - 1, change.modified.endLineNumberExclusive - 1);
					const rangeStartLine = change.modified.isEmpty
						? Math.min(change.modified.startLineNumber - 1, Math.max(currentLines.length - 1, 0))
						: change.modified.startLineNumber - 1;
					return {
						range: new Range(
							rangeStartLine,
							0,
							change.modified.isEmpty ? rangeStartLine : change.modified.endLineNumberExclusive - 1,
							0,
						),
						text: [
							...removedLines.map(line => `-${line}`),
							...addedLines.map(line => `+${line}`),
						].join('\n'),
					};
				});
			return { document, relativeDocumentPath: workspaceService.asRelativePath(file.currentUri), hunks };
		}));

		const changedFiles: CurrentChangeInput[] = fileInputs
			.filter(file => file.hunks.length > 0)
			.map(file => ({
				document: file.document,
				relativeDocumentPath: file.relativeDocumentPath,
				change: { uri: file.document.uri, hunks: file.hunks },
			}));

		if (changedFiles.length === 0) {
			return { type: 'success', comments: [] };
		}

		const result = await instantiationService.createInstance(FeedbackGenerator).generateComments(changedFiles, tokenSource.token);

		if (result.type === 'success') {
			return toCodeReviewResult(result.comments);
		}
		return result.type === 'error' ? { type: 'error', reason: result.reason } : { type: 'cancelled' };
	} catch (err) {
		logService.error(err, 'Error during code review command');
		return { type: 'error', reason: err.message };
	} finally {
		tokenSource.dispose();
	}
}

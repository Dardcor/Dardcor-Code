/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, Disposable, Uri } from 'vscode';

export interface TitleAndDescriptionProvider {
	provideTitleAndDescription(context: { commitMessages: string[]; patches: string[] | { patch: string; fileUri: string; previousFileUri?: string }[]; issues?: { reference: string; content: string }[]; template?: string; compareBranch?: string }, token: CancellationToken): Promise<{ title: string; description?: string } | undefined>;
}

export interface ReviewerComments {
	files: Uri[];
	succeeded: boolean;
	disposable?: Disposable;
}

export interface ReviewerCommentsProvider {
	provideReviewerComments(context: { repositoryRoot: string; commitMessages: string[]; patches: { patch: string; fileUri: string; previousFileUri?: string }[] }, token: CancellationToken): Promise<ReviewerComments>;
}

export interface RepositoryDescription {
	owner: string;
	repositoryName: string;
	defaultBranch: string;
	currentBranch?: string;
	pullRequest?: {
		title: string;
		url: string;
		number: number;
		id: number;
	};
}

export interface API {
	registerTitleAndDescriptionProvider(title: string, provider: TitleAndDescriptionProvider): Disposable;

	registerReviewerCommentsProvider(title: string, provider: ReviewerCommentsProvider): Disposable;

	getRepositoryDescription(uri: Uri): Promise<RepositoryDescription | undefined>;
}

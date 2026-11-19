/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { env, Uri, window, workspace } from 'vscode';
import { IAuthenticationService } from '../../../../platform/authentication/common/authentication';
import { ILogger, ILogService } from '../../../../platform/log/common/logService';
import { IFetcherService } from '../../../../platform/networking/common/fetcherService';
import { LogEntry } from '../../../../platform/workspaceRecorder/common/workspaceLog';
import { encodeBase64, VSBuffer } from '../../../../util/dardcor/base/common/buffer';

export interface FeedbackFile {
	name: string;
	content: string;
}

interface FeedbackRepoConfig {
	readonly owner: string;
	readonly name: string;
	readonly apiUrl: string;
}

export class NesFeedbackSubmitter {

	private static readonly DEFAULT_REPO_CONFIG: FeedbackRepoConfig = {
		owner: 'microsoft',
		name: 'dardcor-nes-feedback',
		apiUrl: 'https://api.github.com'
	};

	private readonly _logger: ILogger;

	constructor(
		logService: ILogService,
		private readonly _authenticationService: IAuthenticationService,
		private readonly _fetcherService: IFetcherService,
		private readonly _repoConfig: FeedbackRepoConfig = NesFeedbackSubmitter.DEFAULT_REPO_CONFIG
	) {
		this._logger = logService.createSubLogger(['NES', 'FeedbackSubmitter']);
	}

	public async submitFromFolder(feedbackFolderUri: Uri): Promise<void> {
		try {
			const files = await this._collectFeedbackFiles(feedbackFolderUri);
			if (files.length === 0) {
				window.showInformationMessage('No NES feedback captures found to submit. Use "Dardcor: Record Expected Edit (NES)" to capture feedback first.');
				return;
			}

			const fileContents = await this._readFeedbackFiles(files, feedbackFolderUri);
			if (fileContents.length === 0) {
				window.showErrorMessage('Failed to read feedback files.');
				return;
			}

			const documentPaths = this._extractDocumentPathsFromRecordings(fileContents);

			const nextUserEditPaths = this._extractNextUserEditPaths(fileContents);

			const excludedPaths = await this._showFilePreviewAndConfirm(documentPaths, nextUserEditPaths);
			if (!excludedPaths) {
				return;
			}

			const filteredContents = this._filterRecordingsByExcludedPaths(fileContents, excludedPaths, nextUserEditPaths);
			if (filteredContents.length === 0) {
				window.showInformationMessage('No files to submit after filtering.');
				return;
			}

			const session = await this._authenticationService.getGitHubSession('permissive', { createIfNone: { detail: l10n.t('Sign in to GitHub to submit feedback.') } });
			if (!session) {
				window.showErrorMessage('GitHub authentication required with repo access. Please sign in to GitHub.');
				return;
			}

			const folderUrl = await this._uploadToPrivateRepo(filteredContents, session.accessToken);

			if (folderUrl) {
				await this._showSuccessDialog(folderUrl);
				this._logger.info(`Uploaded feedback to private repo: ${folderUrl}`);
			}
		} catch (error) {
			this._logger.error(error instanceof Error ? error : String(error), 'Error submitting feedback');
			window.showErrorMessage(`Failed to submit NES feedback: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	private async _showSuccessDialog(prUrl: string): Promise<void> {
		const result = await window.showInformationMessage(
			'Feedback submitted! A pull request has been created.',
			'Open Pull Request',
			'Copy Link'
		);

		if (result === 'Open Pull Request') {
			await env.openExternal(Uri.parse(prUrl));
		} else if (result === 'Copy Link') {
			await env.clipboard.writeText(prUrl);
			window.showInformationMessage('Pull request URL copied to clipboard!');
		}
	}

	private async _collectFeedbackFiles(folderUri: Uri): Promise<Uri[]> {
		try {
			const entries = await workspace.fs.readDirectory(folderUri);
			return entries
				.filter(([name, type]) => type === 1 && name.endsWith('.json'))
				.map(([name]) => Uri.joinPath(folderUri, name));
		} catch {
			return [];
		}
	}

	private async _readFeedbackFiles(fileUris: Uri[], folderUri: Uri): Promise<FeedbackFile[]> {
		const results: FeedbackFile[] = [];

		for (const fileUri of fileUris) {
			try {
				const content = await workspace.fs.readFile(fileUri);
				const textContent = new TextDecoder().decode(content);
				const relativeName = fileUri.path.replace(folderUri.path + '/', '');
				results.push({
					name: relativeName,
					content: textContent
				});
			} catch (e) {
				this._logger.warn(`Failed to read file: ${fileUri.fsPath}: ${e}`);
			}
		}

		return results;
	}

	private _extractDocumentPathsFromRecordings(files: FeedbackFile[]): string[] {
		const paths = new Set<string>();

		for (const file of files) {
			if (!file.name.endsWith('.recording.w.json')) {
				continue;
			}

			try {
				const recording = JSON.parse(file.content) as { log?: LogEntry[] };
				if (recording.log) {
					for (const entry of recording.log) {
						if (entry.kind === 'documentEncountered') {
							paths.add(entry.relativePath);
						}
					}
				}
			} catch {
			}
		}

		return Array.from(paths).sort();
	}

	private _extractNextUserEditPaths(files: FeedbackFile[]): Map<string, string | undefined> {
		const result = new Map<string, string | undefined>();

		for (const file of files) {
			if (!file.name.endsWith('.recording.w.json')) {
				continue;
			}

			try {
				const recording = JSON.parse(file.content) as {
					nextUserEdit?: { relativePath: string };
				};
				result.set(file.name, recording.nextUserEdit?.relativePath);
			} catch {
				result.set(file.name, undefined);
			}
		}

		return result;
	}

	private _countIncludedRecordings(nextUserEditPaths: Map<string, string | undefined>, excludedPaths: Set<string>): number {
		let count = 0;
		for (const [, nextUserEditPath] of nextUserEditPaths) {
			if (nextUserEditPath !== undefined && !excludedPaths.has(nextUserEditPath)) {
				count++;
			}
		}
		return count;
	}

	private _createFilesSummary(paths: string[], maxFiles: number = 5): string {
		const sortedPaths = [...paths].sort();
		if (sortedPaths.length <= maxFiles) {
			return sortedPaths.join(', ');
		}
		const shownFiles = sortedPaths.slice(0, maxFiles).join(', ');
		return `${shownFiles}, and ${sortedPaths.length - maxFiles} more...`;
	}

	private async _showFilePreviewAndConfirm(
		documentPaths: string[],
		nextUserEditPaths: Map<string, string | undefined>
	): Promise<string[] | undefined> {
		const totalRecordingCount = this._countIncludedRecordings(nextUserEditPaths, new Set());

		if (documentPaths.length === 0) {
			const result = await window.showInformationMessage(
				`Found ${totalRecordingCount} feedback recording(s). This will upload your NES feedback to the internal feedback repository.\n\n` +
				`Only team members with access to the private repo can view this data.`,
				{ modal: true },
				'Submit Feedback'
			);
			return result === 'Submit Feedback' ? [] : undefined;
		}

		const filesSummary = this._createFilesSummary(documentPaths);

		const result = await window.showInformationMessage(
			`Found ${totalRecordingCount} recording(s) containing ${documentPaths.length} file(s):\n${filesSummary}\n\n` +
			`This will upload your NES feedback to the internal feedback repository.`,
			{ modal: true },
			'Submit Feedback',
			'Select Files to Include'
		);

		if (result === 'Submit Feedback') {
			return [];
		}

		if (result === 'Select Files to Include') {
			return this._showFileSelectionQuickPick(documentPaths, nextUserEditPaths);
		}

		return undefined;
	}

	private async _showFileSelectionQuickPick(
		documentPaths: string[],
		nextUserEditPaths: Map<string, string | undefined>
	): Promise<string[] | undefined> {
		let currentSelection = new Set(documentPaths);

		while (true) {
			const items = documentPaths.map(path => ({
				label: path,
				description: '',
				picked: currentSelection.has(path)
			}));

			const selected = await window.showQuickPick(items, {
				title: 'Select files to include in the upload',
				placeHolder: 'Deselect files you want to exclude, then press Enter to confirm',
				canPickMany: true,
				ignoreFocusOut: true
			});

			if (!selected) {
				return undefined;
			}

			const selectedPaths = new Set(selected.map(item => item.label));
			const excludedPaths = documentPaths.filter(path => !selectedPaths.has(path));

			if (selectedPaths.size === 0) {
				window.showInformationMessage('No files selected. Upload cancelled.');
				return undefined;
			}

			const excludedPathSet = new Set(excludedPaths);
			const includedRecordingCount = this._countIncludedRecordings(nextUserEditPaths, excludedPathSet);

			if (includedRecordingCount === 0) {
				const tryAgain = await window.showInformationMessage(
					'No recordings would be included with this selection (all nextUserEdit files are excluded).',
					{ modal: true },
					'Edit Selection'
				);
				if (tryAgain === 'Edit Selection') {
					currentSelection = selectedPaths;
					continue;
				}
				return undefined;
			}

			const selectedPathsArray = Array.from(selectedPaths);
			const filesSummary = this._createFilesSummary(selectedPathsArray);

			const confirmMessage = excludedPaths.length > 0
				? `Submit ${includedRecordingCount} recording(s) with ${selectedPaths.size} file(s)? (${excludedPaths.length} excluded)\n\nIncluded: ${filesSummary}`
				: `Submit ${includedRecordingCount} recording(s) containing ${selectedPaths.size} file(s)?\n\n${filesSummary}`;

			const finalResult = await window.showInformationMessage(
				confirmMessage,
				{ modal: true },
				'Submit Feedback',
				'Edit Selection'
			);

			if (finalResult === 'Submit Feedback') {
				return excludedPaths;
			}

			if (finalResult === 'Edit Selection') {
				currentSelection = selectedPaths;
				continue;
			}

			return undefined;
		}
	}

	private _filterRecordingsByExcludedPaths(
		files: FeedbackFile[],
		excludedPaths: string[],
		nextUserEditPaths: Map<string, string | undefined>
	): FeedbackFile[] {
		if (excludedPaths.length === 0) {
			return files;
		}

		const excludedPathSet = new Set(excludedPaths);
		const filteredRecordings: FeedbackFile[] = [];
		const skippedRecordingPrefixes = new Set<string>();

		for (const file of files) {
			if (!file.name.endsWith('.recording.w.json')) {
				continue;
			}

			const nextUserEditPath = nextUserEditPaths.get(file.name);
			if (nextUserEditPath === undefined || excludedPathSet.has(nextUserEditPath)) {
				const prefix = file.name.replace('.recording.w.json', '');
				skippedRecordingPrefixes.add(prefix);
				this._logger.debug(`Skipping recording ${file.name}: nextUserEdit excluded or missing`);
				continue;
			}

			try {
				const filteredFile = this._filterSingleRecording(file, excludedPathSet);
				filteredRecordings.push(filteredFile);
			} catch {
				filteredRecordings.push(file);
			}
		}

		const result: FeedbackFile[] = [...filteredRecordings];
		for (const file of files) {
			if (file.name.endsWith('.metadata.json')) {
				const prefix = file.name.replace('.metadata.json', '');
				if (!skippedRecordingPrefixes.has(prefix)) {
					result.push(file);
				} else {
					this._logger.debug(`Skipping metadata ${file.name}: associated recording was skipped`);
				}
			}
		}

		return result;
	}

	private _filterSingleRecording(file: FeedbackFile, excludedPathSet: Set<string>): FeedbackFile {
		const recording = JSON.parse(file.content) as {
			log?: LogEntry[];
			nextUserEdit?: { relativePath: string; edit: unknown };
		};

		if (!recording.log) {
			return file;
		}

		const excludedDocIds = new Set<number>();
		for (const entry of recording.log) {
			if (entry.kind === 'documentEncountered' && excludedPathSet.has(entry.relativePath)) {
				excludedDocIds.add(entry.id);
			}
		}

		const filteredLog = recording.log.filter(entry => {
			if (entry.kind === 'header') {
				return true;
			}
			if ('id' in entry && typeof entry.id === 'number') {
				return !excludedDocIds.has(entry.id);
			}
			return true;
		});

		const filteredRecording = {
			...recording,
			log: filteredLog
		};

		return {
			name: file.name,
			content: JSON.stringify(filteredRecording, null, 2)
		};
	}

	private async _uploadToPrivateRepo(files: FeedbackFile[], token: string): Promise<string | undefined> {
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
		const folderPath = `feedback/${timestamp}`;

		const user = await this._getCurrentUser(token);
		const username = user?.login ?? 'anonymous';

		const branchName = `feedback/${username}/${timestamp}`;

		const mainBranchSha = await this._getBranchSha(token, 'main');
		if (!mainBranchSha) {
			throw new Error('Failed to get main branch SHA');
		}

		await this._createBranch(token, branchName, mainBranchSha);

		for (const file of files) {
			const filePath = `${folderPath}/${file.name}`;
			await this._createFileInRepo(filePath, file.content, token, username, timestamp, branchName);
		}

		const prUrl = await this._createPullRequest(token, branchName, username, timestamp, files.length);

		return prUrl;
	}

	private async _getBranchSha(token: string, branch: string): Promise<string | undefined> {
		try {
			const response = await this._fetcherService.fetch(
				`${this._repoConfig.apiUrl}/repos/${this._repoConfig.owner}/${this._repoConfig.name}/git/ref/heads/${branch}`,
				{
					method: 'GET',
					callSite: 'nes-feedback-branch-sha',
					headers: {
						'Authorization': `Bearer ${token}`,
						'Accept': 'application/vnd.github+json',
						'X-GitHub-Api-Version': '2022-11-28',
						'User-Agent': this._fetcherService.getUserAgentLibrary()
					}
				}
			);

			if (response.ok) {
				const data = await response.json() as { object: { sha: string } };
				return data.object.sha;
			}
		} catch (e) {
			this._logger.error(e instanceof Error ? e : String(e), 'Failed to get branch SHA');
		}
		return undefined;
	}

	private async _createBranch(token: string, branchName: string, sha: string): Promise<void> {
		const url = `${this._repoConfig.apiUrl}/repos/${this._repoConfig.owner}/${this._repoConfig.name}/git/refs`;

		const payload = {
			ref: `refs/heads/${branchName}`,
			sha: sha
		};

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${token}`,
				'Accept': 'application/vnd.github+json',
				'Content-Type': 'application/json',
				'X-GitHub-Api-Version': '2022-11-28',
				'User-Agent': this._fetcherService.getUserAgentLibrary()
			},
			body: JSON.stringify(payload)
		});

		if (!response.ok) {
			const errorText = await response.text();
			this._logger.error(`Failed to create branch ${branchName}: ${response.status} ${response.statusText} - ${errorText}`);
			throw new Error(`Failed to create branch: ${response.statusText}`);
		}
	}

	private async _createPullRequest(
		token: string,
		branchName: string,
		username: string,
		timestamp: string,
		fileCount: number
	): Promise<string | undefined> {
		const url = `${this._repoConfig.apiUrl}/repos/${this._repoConfig.owner}/${this._repoConfig.name}/pulls`;

		const payload = {
			title: `NES Feedback from ${username} (${timestamp})`,
			head: branchName,
			base: 'main',
			body: `## NES Feedback Submission\n\n` +
				`- **Submitted by:** ${username}\n` +
				`- **Timestamp:** ${timestamp}\n` +
				`- **Files:** ${fileCount} file(s)\n\n` +
				`This feedback was automatically submitted via the "Dardcor: Submit NES Feedback" command.`
		};

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${token}`,
				'Accept': 'application/vnd.github+json',
				'Content-Type': 'application/json',
				'X-GitHub-Api-Version': '2022-11-28',
				'User-Agent': this._fetcherService.getUserAgentLibrary()
			},
			body: JSON.stringify(payload)
		});

		if (!response.ok) {
			const errorText = await response.text();
			this._logger.error(`Failed to create pull request: ${response.status} ${response.statusText} - ${errorText}`);
			throw new Error(`Failed to create pull request: ${response.statusText}`);
		}

		const prData = await response.json() as { html_url: string };
		return prData.html_url;
	}

	private async _createFileInRepo(
		path: string,
		content: string,
		token: string,
		username: string,
		timestamp: string,
		branch: string
	): Promise<void> {
		const url = `${this._repoConfig.apiUrl}/repos/${this._repoConfig.owner}/${this._repoConfig.name}/contents/${path}`;

		const payload = {
			message: `NES feedback from ${username} at ${timestamp}`,
			content: encodeBase64(VSBuffer.fromString(content)),
			branch: branch
		};

		const response = await fetch(url, {
			method: 'PUT',
			headers: {
				'Authorization': `Bearer ${token}`,
				'Accept': 'application/vnd.github+json',
				'Content-Type': 'application/json',
				'X-GitHub-Api-Version': '2022-11-28',
				'User-Agent': this._fetcherService.getUserAgentLibrary()
			},
			body: JSON.stringify(payload)
		});

		if (!response.ok) {
			const errorText = await response.text();
			this._logger.error(`Failed to create file ${path}: ${response.status} ${response.statusText} - ${errorText}`);
			throw new Error(`Failed to upload file: ${response.statusText}`);
		}
	}

	private async _getCurrentUser(token: string): Promise<{ login: string } | undefined> {
		try {
			const response = await this._fetcherService.fetch(
				`${this._repoConfig.apiUrl}/user`,
				{
					method: 'GET',
					callSite: 'nes-feedback-current-user',
					headers: {
						'Authorization': `Bearer ${token}`,
						'Accept': 'application/vnd.github+json',
						'X-GitHub-Api-Version': '2022-11-28',
						'User-Agent': this._fetcherService.getUserAgentLibrary()
					}
				}
			);

			if (response.ok) {
				return await response.json();
			}
		} catch (e) {
			this._logger.warn(`Failed to get current user: ${e}`);
		}
		return undefined;
	}
}

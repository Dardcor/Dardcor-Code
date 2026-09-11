/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IGitHubIssueReference {
	readonly owner: string;
	readonly repo: string;
	readonly number: number;
}

const ISSUE_URL_PATTERN = /\bhttps?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\b/gi;
const ISSUE_SHORTHAND_PATTERN = /(?<![\w./-])([\w.-]+)\/([\w.-]+)#(\d+)\b/g;

export const MAX_SESSION_ISSUE_REFERENCES = 10;

export function parseGitHubIssueReferences(text: string): IGitHubIssueReference[] {
	const references: IGitHubIssueReference[] = [];
	const seen = new Set<string>();

	const add = (owner: string, repo: string, rawNumber: string): void => {
		const number = Number(rawNumber);
		if (!Number.isSafeInteger(number) || number <= 0) {
			return;
		}
		const url = toGitHubIssueUrl({ owner, repo, number });
		if (seen.has(url)) {
			return;
		}
		seen.add(url);
		references.push({ owner, repo, number });
	};

	for (const match of text.matchAll(ISSUE_URL_PATTERN)) {
		add(match[1], match[2], match[3]);
	}
	for (const match of text.matchAll(ISSUE_SHORTHAND_PATTERN)) {
		add(match[1], match[2], match[3]);
	}

	return references;
}

export function toGitHubIssueUrl(reference: IGitHubIssueReference): string {
	return `https://github.com/${reference.owner}/${reference.repo}/issues/${reference.number}`;
}

export function parseGitHubIssueUrl(url: string): IGitHubIssueReference | undefined {
	return parseGitHubIssueReferences(url)[0];
}

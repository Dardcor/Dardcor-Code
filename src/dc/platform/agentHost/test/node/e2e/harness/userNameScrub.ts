/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

function escapeRegExpCharacters(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const USER_NAME_PLACEHOLDER = '${user}';

const LISTING_OWNER_RE = /^([dlcbps-][rwxStTs-]{9}[+@.]?\s+\d+\s+)(\S+)(\s+)(\S+)/gm;
const PATH_SEGMENT_END = '(?=$|[/\\\\\\s"\'`,:;!?#)\\]}>])';
const CLAUDE_PROJECT_DIR_RE = /((?:\/|\\{1,2})\.claude(?:\/|\\{1,2})projects(?:\/|\\{1,2}))([^/\\\s"'`,:;!?)}\]>]+)/g;

export function scrubUserName(text: string, userName: string): string {
	if (!userName) {
		return text;
	}
	const escaped = escapeRegExpCharacters(userName);
	const flattenedHomeUserRe = new RegExp(`((?:^|-)(?:Users|home)-)${escaped}(?=-|$)`, 'g');
	return text
		.replace(new RegExp(`(?<=[/\\\\])${escaped}${PATH_SEGMENT_END}`, 'g'), USER_NAME_PLACEHOLDER)
		.replace(CLAUDE_PROJECT_DIR_RE, (_match, prefix: string, projectDir: string) =>
			`${prefix}${projectDir.replace(flattenedHomeUserRe, (_segment, homePrefix: string) => `${homePrefix}${USER_NAME_PLACEHOLDER}`)}`)
		.replace(LISTING_OWNER_RE, (match, prefix: string, owner: string, gap: string, group: string) => {
			if (owner !== userName && group !== userName) {
				return match;
			}
			const scrubbedOwner = owner === userName ? USER_NAME_PLACEHOLDER : owner;
			const scrubbedGroup = group === userName ? USER_NAME_PLACEHOLDER : group;
			return `${prefix}${scrubbedOwner}${gap}${scrubbedGroup}`;
		});
}

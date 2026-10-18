/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const gitAutoApproveRules: Readonly<Record<string, boolean>> = {
	'/^git(\\s+(-C\\s+\\S+|--no-pager))*\\s+status\\b/': true,
	'/^git(\\s+(-C\\s+\\S+|--no-pager))*\\s+log\\b/': true,
	'/^git(\\s+(-C\\s+\\S+|--no-pager))*\\s+log\\b.*\\s--output(=|\\s|$)/': false,
	'/^git(\\s+(-C\\s+\\S+|--no-pager))*\\s+show\\b/': true,
	'/^git(\\s+(-C\\s+\\S+|--no-pager))*\\s+show\\b.*\\s--output(=|\\s|$)/': false,
	'/^git(\\s+(-C\\s+\\S+|--no-pager))*\\s+diff\\b/': true,
	'/^git(\\s+(-C\\s+\\S+|--no-pager))*\\s+ls-files\\b/': true,

	'/^git(\\s+(-C\\s+\\S+|--no-pager))*\\s+grep\\b/': true,

	'/^git(\\s+(-C\\s+\\S+|--no-pager))*\\s+branch\\b/': true,
	'/^git(\\s+(-C\\s+\\S+|--no-pager))*\\s+branch\\b.*\\s-(d|D|m|M|-delete|-force)\\b/': false,
};

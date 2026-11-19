/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { StringOrMarkdown, FileEdit, ErrorInfo } from '../common/state.js';


export interface Changeset {
	label: string;
	uriTemplate: string;
	description?: string;
	changeKind: string;
	capabilities?: ChangesetCapabilities;
}

export interface ChangesetCapabilities {
	review?: Record<string, never>;
}

export const enum ChangesetStatus {
	Computing = 'computing',
	Ready = 'ready',
	Error = 'error',
}

export interface ChangesetState {
	status: ChangesetStatus;
	error?: ErrorInfo;
	files: ChangesetFile[];
	operations?: ChangesetOperation[];
}

export interface ChangesetFile {
	id: string;
	edit: FileEdit;
	reviewed?: boolean;
	_meta?: Record<string, unknown>;
}

export const enum ChangesetOperationStatus {
	Idle = 'idle',
	Running = 'running',
	Error = 'error',
	Disabled = 'disabled',
}

export const enum ChangesetOperationScope {
	Changeset = 'changeset',
	Resource = 'resource',
	Range = 'range',
}

export interface ChangesetOperation {
	id: string;
	label: string;
	description?: string;
	scopes: ChangesetOperationScope[];
	confirmation?: StringOrMarkdown;
	icon?: string;
	group?: string;
	status: ChangesetOperationStatus;
	error?: ErrorInfo;
}

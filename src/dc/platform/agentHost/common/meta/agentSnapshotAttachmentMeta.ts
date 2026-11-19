/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isString } from '../../../../base/common/types.js';
import { MessageAttachmentKind, type MessageAttachment } from '../state/protocol/state.js';

export const HostSnapshotAttachmentMetadataKey = 'vscode.agentHost.snapshotAttachment';

export interface IHostSnapshotAttachmentMetadata {
	readonly isSnapshot: true;
	readonly contentType?: string;
}

export function toHostSnapshotAttachmentMeta(contentType: string | undefined): Record<string, IHostSnapshotAttachmentMetadata> {
	return {
		[HostSnapshotAttachmentMetadataKey]: contentType ? { isSnapshot: true, contentType } : { isSnapshot: true }
	};
}

export function readHostSnapshotAttachmentMeta(attachment: { readonly _meta?: Record<string, unknown> }): IHostSnapshotAttachmentMetadata | undefined {
	const metadata = attachment._meta?.[HostSnapshotAttachmentMetadataKey];
	if (!isRecord(metadata) || metadata.isSnapshot !== true) {
		return undefined;
	}
	const contentType = isString(metadata.contentType) ? metadata.contentType : undefined;
	return contentType ? { isSnapshot: true, contentType } : { isSnapshot: true };
}

export function isHostSnapshotAttachment(attachment: MessageAttachment): boolean {
	return attachment.type === MessageAttachmentKind.Resource && readHostSnapshotAttachmentMeta(attachment) !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

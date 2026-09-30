/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { URI } from '../../util/dardcor/base/common/uri';

export interface FileSnapshot {
	readonly uri: URI;
	readonly originalContent: string;
	currentContent: string;
	readonly timestamp: number;
}

export class SnapshotTracker {
	private readonly _snapshots = new Map<string, FileSnapshot>();

	track(uri: URI | vscode.Uri, content: string): void {
		const key = uri.toString();
		if (!this._snapshots.has(key)) {
			this._snapshots.set(key, {
				uri: URI.revive(uri),
				originalContent: content,
				currentContent: content,
				timestamp: Date.now(),
			});
		} else {
			const existing = this._snapshots.get(key)!;
			existing.currentContent = content;
		}
	}

	has(uri: URI | vscode.Uri): boolean {
		return this._snapshots.has(uri.toString());
	}

	get(uri: URI | vscode.Uri): FileSnapshot | undefined {
		return this._snapshots.get(uri.toString());
	}

	getTrackedUris(): URI[] {
		return Array.from(this._snapshots.values()).map(s => s.uri);
	}

	clear(): void {
		this._snapshots.clear();
	}
}

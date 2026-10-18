/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { FileType } from '../../../platform/filesystem/common/fileTypes';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import { ResourceMap } from '../../../util/dardcor/base/common/map';
import { URI } from '../../../util/dardcor/base/common/uri';
import { FileTree, IChatDiskSessionResources } from '../common/chatDiskSessionResources';

const SESSION_RESOURCES_DIR_NAME = 'chat-session-resources';

const RETENTION_PERIOD_MS = 8 * 60 * 60 * 1000;

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function sanitizePathComponent(str: string): string {
	return str.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

export class ChatDiskSessionResources extends Disposable implements IChatDiskSessionResources {
	declare readonly _serviceBrand: undefined;

	private readonly baseStorageUri: URI | undefined;
	private readonly accessTimestamps = new ResourceMap<number>();
	private cleanupTimer: ReturnType<typeof setInterval> | undefined;

	public currentCleanup?: Promise<void>;

	constructor(
		@IVSCodeExtensionContext private readonly extensionContext: IVSCodeExtensionContext,
		@IFileSystemService private readonly fileSystem: IFileSystemService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this.baseStorageUri = this.extensionContext.storageUri
			? URI.joinPath(this.extensionContext.storageUri, SESSION_RESOURCES_DIR_NAME)
			: undefined;

		this.cleanupTimer = setInterval(() => {
			this.currentCleanup = this.cleanupStaleResources().catch(err => {
				this.logService.warn(`[ChatDiskSessionResources] Cleanup error: ${err}`);
			});
		}, CLEANUP_INTERVAL_MS);

		this.currentCleanup = this.cleanupStaleResources().catch(err => {
			this.logService.warn(`[ChatDiskSessionResources] Initial cleanup error: ${err}`);
		});
	}

	override dispose(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = undefined;
		}
		super.dispose();
	}

	async ensure(sessionId: string, subdir: string, files: string | FileTree): Promise<URI> {
		if (!this.baseStorageUri) {
			throw new Error('Storage URI not available');
		}

		const sanitizedSessionId = sanitizePathComponent(sessionId);
		const sanitizedSubdir = sanitizePathComponent(subdir);

		const targetDir = URI.joinPath(this.baseStorageUri, sanitizedSessionId, sanitizedSubdir);

		await this.ensureDirectoryExists(targetDir);

		if (typeof files === 'string') {
			const fileUri = URI.joinPath(targetDir, 'content.txt');
			await this.writeFileIfNotExists(fileUri, files);
		} else {
			await this.writeFileTree(targetDir, files);
		}

		this.markAccessed(targetDir);
		return targetDir;
	}

	isSessionResourceUri(uri: URI): boolean {
		if (!this.baseStorageUri) {
			return false;
		}
		const basePath = this.baseStorageUri.path.toLowerCase();
		const uriPath = uri.path.toLowerCase();
		return uri.scheme === this.baseStorageUri.scheme && uriPath.startsWith(basePath);
	}

	private async writeFileTree(baseDir: URI, tree: FileTree): Promise<void> {
		for (const [name, content] of Object.entries(tree)) {
			const sanitizedName = sanitizePathComponent(name);
			const targetPath = URI.joinPath(baseDir, sanitizedName);

			if (typeof content === 'string') {
				await this.writeFileIfNotExists(targetPath, content);
			} else if (content !== undefined) {
				await this.ensureDirectoryExists(targetPath);
				await this.writeFileTree(targetPath, content);
			}
		}
	}

	private async writeFileIfNotExists(uri: URI, content: string): Promise<void> {
		try {
			await this.fileSystem.stat(uri);
			this.markAccessed(uri);
		} catch {
			await this.fileSystem.writeFile(uri, new TextEncoder().encode(content));
			this.markAccessed(uri);
		}
	}

	private async ensureDirectoryExists(dir: URI): Promise<void> {
		try {
			const stat = await this.fileSystem.stat(dir);
			if (stat.type !== FileType.Directory) {
				await this.fileSystem.delete(dir, { recursive: false });
				await this.fileSystem.createDirectory(dir);
			}
		} catch {
			await this.fileSystem.createDirectory(dir);
		}
	}

	private markAccessed(uri: URI): void {
		this.accessTimestamps.set(uri, Date.now());
	}

	private async cleanupStaleResources(): Promise<void> {
		if (!this.baseStorageUri) {
			return;
		}

		try {
			try {
				const stat = await this.fileSystem.stat(this.baseStorageUri);
				if (stat.type !== FileType.Directory) {
					return;
				}
			} catch {
				return;
			}

			const now = Date.now();
			const cutoffTime = now - RETENTION_PERIOD_MS;

			const entries = await this.fileSystem.readDirectory(this.baseStorageUri);
			const sessionDirs = entries.filter(([, type]) => type === FileType.Directory);

			for (const [sessionName] of sessionDirs) {
				const sessionUri = URI.joinPath(this.baseStorageUri, sessionName);
				await this.cleanupSessionDirectory(sessionUri, cutoffTime);
			}

			for (const [sessionName] of sessionDirs) {
				const sessionUri = URI.joinPath(this.baseStorageUri, sessionName);
				try {
					const sessionEntries = await this.fileSystem.readDirectory(sessionUri);
					if (sessionEntries.length === 0) {
						await this.fileSystem.delete(sessionUri, { recursive: true });
						this.logService.debug(`[ChatDiskSessionResources] Deleted empty session directory: ${sessionUri.fsPath}`);
					}
				} catch {
				}
			}
		} catch (error) {
			this.logService.warn(`[ChatDiskSessionResources] Error during cleanup: ${error}`);
		}
	}

	private async cleanupSessionDirectory(sessionUri: URI, cutoffTime: number): Promise<void> {
		try {
			const entries = await this.fileSystem.readDirectory(sessionUri);

			for (const [name, type] of entries) {
				const entryUri = URI.joinPath(sessionUri, name);

				const accessTime = this.accessTimestamps.get(entryUri);
				if (accessTime && accessTime >= cutoffTime) {
					continue;
				}

				try {
					const stat = await this.fileSystem.stat(entryUri);
					if (stat.mtime >= cutoffTime) {
						this.accessTimestamps.set(entryUri, stat.mtime);
						continue;
					}
				} catch {
				}

				try {
					await this.fileSystem.delete(entryUri, { recursive: type === FileType.Directory });
					this.accessTimestamps.delete(entryUri);
					this.logService.debug(`[ChatDiskSessionResources] Deleted stale resource: ${entryUri.fsPath}`);
				} catch (error) {
					this.logService.warn(`[ChatDiskSessionResources] Failed to delete ${entryUri.fsPath}: ${error}`);
				}
			}
		} catch (error) {
			this.logService.debug(`[ChatDiskSessionResources] Error cleaning session directory ${sessionUri.fsPath}: ${error}`);
		}
	}
}

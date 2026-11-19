/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FileType } from '../../../../platform/filesystem/common/fileTypes';
import { MockFileSystemService } from '../../../../platform/filesystem/node/test/mockFileSystemService';
import { TestLogService } from '../../../../platform/testing/common/testLogService';
import { URI } from '../../../../util/dardcor/base/common/uri';
import { ChatDiskSessionResources } from '../chatDiskSessionResourcesImpl';

class MockExtensionContextWithStorage {
	readonly storageUri = URI.file('/test-storage');
}

const RETENTION_PERIOD_MS = 8 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

describe('ChatDiskSessionResources', () => {
	let mockFs: MockFileSystemService;
	let service: ChatDiskSessionResources;

	beforeEach(() => {
		mockFs = new MockFileSystemService();
		const mockContext = new MockExtensionContextWithStorage();
		const logService = new TestLogService();

		mockFs.mockDirectory(mockContext.storageUri, []);

		service = new ChatDiskSessionResources(
			mockContext as any,
			mockFs,
			logService
		);
	});

	afterEach(() => {
		service.dispose();
		vi.resetAllMocks();
	});

	describe('ensure', () => {
		test('creates file with string content', async () => {
			const sessionId = 'session-123';
			const subdir = 'tool-result-1';
			const content = 'Hello, world!';

			const resultUri = await service.ensure(sessionId, subdir, content);

			expect(resultUri).toBeDefined();
			expect(resultUri.path).toContain('session-123');
			expect(resultUri.path).toContain('tool-result-1');
		});

		test('sanitizes session ID and subdir with special characters', async () => {
			const sessionId = 'session/with:special*chars';
			const subdir = 'tool<result>';
			const content = 'Test content';

			const resultUri = await service.ensure(sessionId, subdir, content);

			expect(resultUri.path).toContain('session_with_special_chars');
			expect(resultUri.path).toContain('tool_result_');
		});

		test('creates file tree with nested structure', async () => {
			const sessionId = 'session-456';
			const subdir = 'complex-result';
			const files = {
				'readme.txt': 'This is a readme',
				'src': {
					'main.ts': 'console.log("hello")',
					'utils': {
						'helper.ts': 'export function help() {}'
					}
				}
			};

			const resultUri = await service.ensure(sessionId, subdir, files);

			expect(resultUri).toBeDefined();
			expect(resultUri.path).toContain('session-456');
		});

		test('is idempotent for same content', async () => {
			const sessionId = 'session-789';
			const subdir = 'idempotent-test';
			const content = 'Same content';

			const uri1 = await service.ensure(sessionId, subdir, content);
			const uri2 = await service.ensure(sessionId, subdir, content);

			expect(uri1.toString()).toBe(uri2.toString());
		});
	});

	describe('isSessionResourceUri', () => {
		test('returns true for URIs within storage directory', async () => {
			const sessionId = 'session-abc';
			const subdir = 'test-subdir';
			const content = 'Test';

			const resultUri = await service.ensure(sessionId, subdir, content);

			expect(service.isSessionResourceUri(resultUri)).toBe(true);
		});

		test('returns false for URIs outside storage directory', () => {
			const externalUri = URI.file('/some/other/path');

			expect(service.isSessionResourceUri(externalUri)).toBe(false);
		});

		test('returns false for workspace URIs', () => {
			const workspaceUri = URI.file('/workspace/project/file.ts');

			expect(service.isSessionResourceUri(workspaceUri)).toBe(false);
		});
	});

	describe('path sanitization', () => {
		test('preserves alphanumeric characters', async () => {
			const sessionId = 'abc123XYZ';
			const subdir = 'test456';
			const content = 'Test';

			const resultUri = await service.ensure(sessionId, subdir, content);

			expect(resultUri.path).toContain('abc123XYZ');
			expect(resultUri.path).toContain('test456');
		});

		test('preserves underscores and hyphens', async () => {
			const sessionId = 'session_with-dashes';
			const subdir = 'tool_result-1';
			const content = 'Test';

			const resultUri = await service.ensure(sessionId, subdir, content);

			expect(resultUri.path).toContain('session_with-dashes');
			expect(resultUri.path).toContain('tool_result-1');
		});

		test('handles empty strings after sanitization gracefully', async () => {
			const sessionId = '';
			const subdir = '';
			const content = 'Test';

			const resultUri = await service.ensure(sessionId, subdir, content);

			expect(resultUri).toBeDefined();
			expect(resultUri.path).toContain('chat-session-resources');
		});
	});

	describe('file content handling', () => {
		test('handles empty string content', async () => {
			const sessionId = 'session-empty';
			const subdir = 'empty-content';
			const content = '';

			const resultUri = await service.ensure(sessionId, subdir, content);

			expect(resultUri).toBeDefined();
		});

		test('handles large content', async () => {
			const sessionId = 'session-large';
			const subdir = 'large-content';
			const content = 'x'.repeat(100000);

			const resultUri = await service.ensure(sessionId, subdir, content);

			expect(resultUri).toBeDefined();
		});

		test('handles unicode content', async () => {
			const sessionId = 'session-unicode';
			const subdir = 'unicode-content';
			const content = '你好世界 🌍 مرحبا';

			const resultUri = await service.ensure(sessionId, subdir, content);

			expect(resultUri).toBeDefined();
		});
	});

	describe('cleanup and expiration', () => {
		let mockContext: MockExtensionContextWithStorage;
		let logService: TestLogService;

		beforeEach(() => {
			vi.useFakeTimers({ shouldAdvanceTime: false });
			mockFs = new MockFileSystemService();
			mockContext = new MockExtensionContextWithStorage();
			logService = new TestLogService();
			mockFs.mockDirectory(mockContext.storageUri, [['chat-session-resources', FileType.Directory]]);
			mockFs.mockDirectory(URI.joinPath(mockContext.storageUri, 'chat-session-resources'), []);
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		test('cleanup runs on scheduled interval', async () => {
			vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

			const testService = new ChatDiskSessionResources(
				mockContext as any,
				mockFs,
				logService
			);

			const resultUri = await testService.ensure('session-1', 'tool-1', 'content');

			const stat = await mockFs.stat(resultUri);
			expect(stat.type).toBe(FileType.Directory);

			await vi.advanceTimersByTimeAsync(RETENTION_PERIOD_MS + CLEANUP_INTERVAL_MS + 1000);
			await testService.currentCleanup;

			await expect(mockFs.stat(resultUri)).rejects.toThrow();

			testService.dispose();
		});

		test('recently accessed resources are not cleaned up', async () => {
			vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

			const testService = new ChatDiskSessionResources(
				mockContext as any,
				mockFs,
				logService
			);

			const resultUri = await testService.ensure('session-fresh', 'tool-fresh', 'fresh content');

			await vi.advanceTimersByTimeAsync(RETENTION_PERIOD_MS / 2);

			await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS);

			const contentUri = URI.joinPath(resultUri, 'content.txt');
			const stat = await mockFs.stat(contentUri);
			expect(stat.type).toBe(FileType.File);

			testService.dispose();
		});

		test('resources older than retention period are cleaned up', async () => {
			vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

			const testService = new ChatDiskSessionResources(
				mockContext as any,
				mockFs,
				logService
			);

			const resultUri = await testService.ensure('session-old', 'tool-old', 'old content');

			const stat = await mockFs.stat(resultUri);
			expect(stat.type).toBe(FileType.Directory);

			await vi.advanceTimersByTimeAsync(RETENTION_PERIOD_MS + CLEANUP_INTERVAL_MS + 1000);
			await testService.currentCleanup;

			await expect(mockFs.stat(resultUri)).rejects.toThrow();

			testService.dispose();
		});

		test('empty session directories are removed during cleanup', async () => {
			vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

			const testService = new ChatDiskSessionResources(
				mockContext as any,
				mockFs,
				logService
			);

			await testService.ensure('session-empty-dir', 'tool-1', 'content');

			await vi.advanceTimersByTimeAsync(RETENTION_PERIOD_MS + CLEANUP_INTERVAL_MS + 1000);

			await testService.currentCleanup;

			const sessionUri = URI.joinPath(mockContext.storageUri, 'chat-session-resources', 'session-empty-dir');
			await expect(mockFs.stat(sessionUri)).rejects.toThrow();

			testService.dispose();
		});

		test('dispose cancels cleanup timer', async () => {
			vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

			const testService = new ChatDiskSessionResources(
				mockContext as any,
				mockFs,
				logService
			);

			const resultUri = URI.joinPath(
				mockContext.storageUri,
				'chat-session-resources',
				'session-dispose',
				'tool-1',
				'content.txt'
			);
			await testService.ensure('session-dispose', 'tool-1', 'content');

			testService.dispose();

			await vi.advanceTimersByTimeAsync(RETENTION_PERIOD_MS + CLEANUP_INTERVAL_MS + 1000);

			await testService.currentCleanup;

			const stat = await mockFs.stat(resultUri);
			expect(stat.type).toBe(FileType.File);
		});

		test('accessing resource resets its expiration timer', async () => {
			vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

			const testService = new ChatDiskSessionResources(
				mockContext as any,
				mockFs,
				logService
			);

			const resultUri = await testService.ensure('session-refresh', 'tool-refresh', 'content v1');

			await vi.advanceTimersByTimeAsync(RETENTION_PERIOD_MS - 1000);

			await testService.ensure('session-refresh', 'tool-refresh', 'content v2');

			await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS + 2000);

			await testService.currentCleanup;

			const contentUri = URI.joinPath(resultUri, 'content.txt');
			const stat = await mockFs.stat(contentUri);
			expect(stat.type).toBe(FileType.File);

			testService.dispose();
		});
	});
});


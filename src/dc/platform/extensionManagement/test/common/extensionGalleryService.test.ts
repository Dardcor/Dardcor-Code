/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { isUUID } from '../../../../base/common/uuid.js';
import { mock } from '../../../../base/test/common/mock.js';
import { IConfigurationService } from '../../../configuration/common/configuration.js';
import { TestConfigurationService } from '../../../configuration/test/common/testConfigurationService.js';
import { IEnvironmentService } from '../../../environment/common/environment.js';
import { IRawGalleryExtensionVersion, sortExtensionVersions, filterLatestExtensionVersionsForTargetPlatform } from '../../common/extensionGalleryService.js';
import { IFileService } from '../../../files/common/files.js';
import { FileService } from '../../../files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../log/common/log.js';
import product from '../../../product/common/product.js';
import { IProductService } from '../../../product/common/productService.js';
import { resolveMarketplaceHeaders } from '../../../externalServices/common/marketplace.js';
import { InMemoryStorageService, IStorageService } from '../../../storage/common/storage.js';
import { TelemetryConfiguration, TELEMETRY_SETTING_ID } from '../../../telemetry/common/telemetry.js';
import { TargetPlatform } from '../../../extensions/common/extensions.js';
import { NullTelemetryService } from '../../../telemetry/common/telemetryUtils.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

class EnvironmentServiceMock extends mock<IEnvironmentService>() {
	override readonly serviceMachineIdResource: URI;
	constructor(serviceMachineIdResource: URI) {
		super();
		this.serviceMachineIdResource = serviceMachineIdResource;
		this.isBuilt = true;
	}
}

suite('Extension Gallery Service', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let fileService: IFileService, environmentService: IEnvironmentService, storageService: IStorageService, productService: IProductService, configurationService: IConfigurationService;

	setup(() => {
		const serviceMachineIdResource = joinPath(URI.file('tests').with({ scheme: 'vscode-tests' }), 'machineid');
		environmentService = new EnvironmentServiceMock(serviceMachineIdResource);
		fileService = disposables.add(new FileService(new NullLogService()));
		const fileSystemProvider = disposables.add(new InMemoryFileSystemProvider());
		disposables.add(fileService.registerProvider(serviceMachineIdResource.scheme, fileSystemProvider));
		storageService = disposables.add(new InMemoryStorageService());
		configurationService = new TestConfigurationService({ [TELEMETRY_SETTING_ID]: TelemetryConfiguration.ON });
		configurationService.updateValue(TELEMETRY_SETTING_ID, TelemetryConfiguration.ON);
		productService = { _serviceBrand: undefined, ...product, enableTelemetry: true };
	});

	test('marketplace machine id', async () => {
		const headers = await resolveMarketplaceHeaders(product.version, productService, environmentService, configurationService, fileService, storageService, NullTelemetryService);
		assert.ok(headers['X-Market-User-Id']);
		assert.ok(isUUID(headers['X-Market-User-Id']));
		const headers2 = await resolveMarketplaceHeaders(product.version, productService, environmentService, configurationService, fileService, storageService, NullTelemetryService);
		assert.strictEqual(headers['X-Market-User-Id'], headers2['X-Market-User-Id']);
	});

	test('sorting single extension version without target platform', async () => {
		const actual = [aExtensionVersion('1.1.2')];
		const expected = [...actual];
		sortExtensionVersions(actual, TargetPlatform.DARWIN_X64);
		assert.deepStrictEqual(actual, expected);
	});

	test('sorting single extension version with preferred target platform', async () => {
		const actual = [aExtensionVersion('1.1.2', TargetPlatform.DARWIN_X64)];
		const expected = [...actual];
		sortExtensionVersions(actual, TargetPlatform.DARWIN_X64);
		assert.deepStrictEqual(actual, expected);
	});

	test('sorting single extension version with not compatible target platform', async () => {
		const actual = [aExtensionVersion('1.1.2', TargetPlatform.DARWIN_ARM64)];
		const expected = [...actual];
		sortExtensionVersions(actual, TargetPlatform.WIN32_X64);
		assert.deepStrictEqual(actual, expected);
	});

	test('sorting multiple extension versions without target platforms', async () => {
		const actual = [aExtensionVersion('1.2.4'), aExtensionVersion('1.1.3'), aExtensionVersion('1.1.2'), aExtensionVersion('1.1.1')];
		const expected = [...actual];
		sortExtensionVersions(actual, TargetPlatform.WIN32_ARM64);
		assert.deepStrictEqual(actual, expected);
	});

	test('sorting multiple extension versions with target platforms - 1', async () => {
		const actual = [aExtensionVersion('1.2.4', TargetPlatform.DARWIN_ARM64), aExtensionVersion('1.2.4', TargetPlatform.WIN32_ARM64), aExtensionVersion('1.2.4', TargetPlatform.LINUX_ARM64), aExtensionVersion('1.1.3'), aExtensionVersion('1.1.2'), aExtensionVersion('1.1.1')];
		const expected = [actual[1], actual[0], actual[2], actual[3], actual[4], actual[5]];
		sortExtensionVersions(actual, TargetPlatform.WIN32_ARM64);
		assert.deepStrictEqual(actual, expected);
	});

	test('sorting multiple extension versions with target platforms - 2', async () => {
		const actual = [aExtensionVersion('1.2.4'), aExtensionVersion('1.2.3', TargetPlatform.DARWIN_ARM64), aExtensionVersion('1.2.3', TargetPlatform.WIN32_ARM64), aExtensionVersion('1.2.3', TargetPlatform.LINUX_ARM64), aExtensionVersion('1.1.2'), aExtensionVersion('1.1.1')];
		const expected = [actual[0], actual[3], actual[1], actual[2], actual[4], actual[5]];
		sortExtensionVersions(actual, TargetPlatform.LINUX_ARM64);
		assert.deepStrictEqual(actual, expected);
	});

	test('sorting multiple extension versions with target platforms - 3', async () => {
		const actual = [aExtensionVersion('1.2.4'), aExtensionVersion('1.1.2'), aExtensionVersion('1.1.1'), aExtensionVersion('1.0.0', TargetPlatform.DARWIN_ARM64), aExtensionVersion('1.0.0', TargetPlatform.WIN32_ARM64)];
		const expected = [actual[0], actual[1], actual[2], actual[4], actual[3]];
		sortExtensionVersions(actual, TargetPlatform.WIN32_ARM64);
		assert.deepStrictEqual(actual, expected);
	});

	function aExtensionVersion(version: string, targetPlatform?: TargetPlatform): IRawGalleryExtensionVersion {
		return { version, targetPlatform } as IRawGalleryExtensionVersion;
	}

	function aPreReleaseExtensionVersion(version: string, targetPlatform?: TargetPlatform): IRawGalleryExtensionVersion {
		return {
			version,
			targetPlatform,
			properties: [{ key: 'Microsoft.VisualStudio.Code.PreRelease', value: 'true' }]
		} as IRawGalleryExtensionVersion;
	}

	suite('filterLatestExtensionVersionsForTargetPlatform', () => {

		test('should return empty array for empty input', () => {
			const result = filterLatestExtensionVersionsForTargetPlatform([], TargetPlatform.WIN32_X64, [TargetPlatform.WIN32_X64]);
			assert.deepStrictEqual(result, []);
		});

		test('should return single version when only one version provided', () => {
			const versions = [aExtensionVersion('1.0.0', TargetPlatform.WIN32_X64)];
			const allTargetPlatforms = [TargetPlatform.WIN32_X64];
			const result = filterLatestExtensionVersionsForTargetPlatform(versions, TargetPlatform.WIN32_X64, allTargetPlatforms);
			assert.deepStrictEqual(result, versions);
		});

		test('should include latest release and latest pre-release versions for same platform', () => {
			const release = aExtensionVersion('1.0.0', TargetPlatform.WIN32_X64);
			const prerelease = aPreReleaseExtensionVersion('0.9.0', TargetPlatform.WIN32_X64);
			const versions = [release, prerelease];
			const allTargetPlatforms = [TargetPlatform.WIN32_X64];

			const result = filterLatestExtensionVersionsForTargetPlatform(versions, TargetPlatform.WIN32_X64, allTargetPlatforms);

			assert.strictEqual(result.length, 2);
			assert.strictEqual(result[0], release);
			assert.strictEqual(result[1], prerelease);
		});

		test('should include latest prerelease and latest release versions for same platform', () => {
			const prerelease = aPreReleaseExtensionVersion('1.1.0', TargetPlatform.WIN32_X64);
			const release = aExtensionVersion('1.0.0', TargetPlatform.WIN32_X64);
			const versions = [prerelease, release];
			const allTargetPlatforms = [TargetPlatform.WIN32_X64];

			const result = filterLatestExtensionVersionsForTargetPlatform(versions, TargetPlatform.WIN32_X64, allTargetPlatforms);

			assert.strictEqual(result.length, 2);
			assert.strictEqual(result[0], prerelease);
			assert.strictEqual(result[1], release);
		});

		test('should include one version per target platform for release versions', () => {
			const version1 = aExtensionVersion('1.0.0', TargetPlatform.WIN32_X64);
			const version2 = aExtensionVersion('1.0.0', TargetPlatform.DARWIN_X64);
			const version3 = aExtensionVersion('1.0.0', TargetPlatform.LINUX_X64);
			const versions = [version1, version2, version3];
			const allTargetPlatforms = [TargetPlatform.WIN32_X64, TargetPlatform.DARWIN_X64, TargetPlatform.LINUX_X64];

			const result = filterLatestExtensionVersionsForTargetPlatform(versions, TargetPlatform.WIN32_X64, allTargetPlatforms);

			assert.strictEqual(result.length, 3);
			assert.ok(result.includes(version1));
			assert.ok(result.includes(version2));
			assert.ok(result.includes(version3));
		});


		test('should handle versions without target platform (UNDEFINED)', () => {
			const version1 = aExtensionVersion('1.0.0');
			const version2 = aExtensionVersion('0.9.0');
			const versions = [version1, version2];
			const allTargetPlatforms = [TargetPlatform.WIN32_X64];

			const result = filterLatestExtensionVersionsForTargetPlatform(versions, TargetPlatform.WIN32_X64, allTargetPlatforms);

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0], version1);
		});

		test('should handle mixed release and pre-release versions across multiple platforms', () => {
			const releaseWin = aExtensionVersion('1.0.0', TargetPlatform.WIN32_X64);
			const releaseMac = aExtensionVersion('1.0.0', TargetPlatform.DARWIN_X64);
			const preReleaseWin = aPreReleaseExtensionVersion('1.1.0', TargetPlatform.WIN32_X64);
			const preReleaseMac = aPreReleaseExtensionVersion('1.1.0', TargetPlatform.DARWIN_X64);

			const versions = [releaseWin, releaseMac, preReleaseWin, preReleaseMac];
			const allTargetPlatforms = [TargetPlatform.WIN32_X64, TargetPlatform.DARWIN_X64];

			const result = filterLatestExtensionVersionsForTargetPlatform(versions, TargetPlatform.WIN32_X64, allTargetPlatforms);

			assert.strictEqual(result.length, 4);
			assert.ok(result.includes(releaseWin));
			assert.ok(result.includes(releaseMac));
			assert.ok(result.includes(preReleaseWin));
			assert.ok(result.includes(preReleaseMac));
		});

		test('should handle complex scenario with multiple versions and platforms', () => {
			const versions = [
				aExtensionVersion('2.0.0', TargetPlatform.WIN32_X64),
				aExtensionVersion('2.0.0', TargetPlatform.DARWIN_X64),
				aPreReleaseExtensionVersion('2.1.0', TargetPlatform.WIN32_X64),
				aPreReleaseExtensionVersion('2.1.0', TargetPlatform.LINUX_X64),
				aExtensionVersion('2.0.0'),
				aPreReleaseExtensionVersion('2.1.0'),
			];
			const allTargetPlatforms = [TargetPlatform.WIN32_X64, TargetPlatform.DARWIN_X64, TargetPlatform.LINUX_X64];

			const result = filterLatestExtensionVersionsForTargetPlatform(versions, TargetPlatform.WIN32_X64, allTargetPlatforms);

			assert.strictEqual(result.length, 4);

			assert.ok(result.includes(versions[0]));
			assert.ok(result.includes(versions[1]));
			assert.ok(result.includes(versions[2]));
			assert.ok(result.includes(versions[3]));
		});

		test('should keep only first compatible version when specific platform comes before undefined', () => {
			const versions = [
				aExtensionVersion('1.0.0', TargetPlatform.WIN32_X64),
				aExtensionVersion('1.0.0'),
			];
			const allTargetPlatforms = [TargetPlatform.WIN32_X64, TargetPlatform.DARWIN_X64];

			const result = filterLatestExtensionVersionsForTargetPlatform(versions, TargetPlatform.WIN32_X64, allTargetPlatforms);

			assert.strictEqual(result.length, 1);
			assert.ok(result.includes(versions[0]));
		});

		test('should handle higher version with specific platform vs lower version with universal platform', () => {
			const higherVersionSpecificPlatform = aExtensionVersion('2.0.0', TargetPlatform.WIN32_X64);
			const lowerVersionUniversal = aExtensionVersion('1.5.0');

			const versions = [higherVersionSpecificPlatform, lowerVersionUniversal];
			const allTargetPlatforms = [TargetPlatform.WIN32_X64, TargetPlatform.DARWIN_X64];

			const result = filterLatestExtensionVersionsForTargetPlatform(versions, TargetPlatform.WIN32_X64, allTargetPlatforms);

			assert.strictEqual(result.length, 1);
			assert.ok(result.includes(higherVersionSpecificPlatform));
			assert.ok(!result.includes(lowerVersionUniversal));
		});

		test('should handle higher version with universal platform vs lower version with specific platform', () => {
			const higherVersionUniversal = aExtensionVersion('2.0.0');
			const lowerVersionSpecificPlatform = aExtensionVersion('1.0.0', TargetPlatform.WIN32_X64);

			const versions = [higherVersionUniversal, lowerVersionSpecificPlatform];
			const allTargetPlatforms = [TargetPlatform.WIN32_X64, TargetPlatform.DARWIN_X64];

			const result = filterLatestExtensionVersionsForTargetPlatform(versions, TargetPlatform.WIN32_X64, allTargetPlatforms);

			assert.strictEqual(result.length, 1);
			assert.ok(result.includes(higherVersionUniversal));
			assert.ok(!result.includes(lowerVersionSpecificPlatform));
		});

		test('should handle multiple specific platforms vs universal platform with version differences', () => {
			const versions = [
				aExtensionVersion('2.0.0', TargetPlatform.WIN32_X64),
				aExtensionVersion('1.9.0', TargetPlatform.DARWIN_X64),
				aExtensionVersion('1.8.0'),
			];
			const allTargetPlatforms = [TargetPlatform.WIN32_X64, TargetPlatform.DARWIN_X64, TargetPlatform.LINUX_X64];

			const result = filterLatestExtensionVersionsForTargetPlatform(versions, TargetPlatform.WIN32_X64, allTargetPlatforms);

			assert.strictEqual(result.length, 2);
			assert.ok(result.includes(versions[0]));
			assert.ok(result.includes(versions[1]));
		});

		test('should include universal platform when no specific platforms conflict', () => {
			const universalVersion = aExtensionVersion('1.0.0');
			const specificVersion = aExtensionVersion('1.0.0', TargetPlatform.LINUX_ARM64);

			const versions = [universalVersion, specificVersion];
			const allTargetPlatforms = [TargetPlatform.WIN32_X64, TargetPlatform.DARWIN_X64];

			const result = filterLatestExtensionVersionsForTargetPlatform(versions, TargetPlatform.WIN32_X64, allTargetPlatforms);

			assert.strictEqual(result.length, 2);
			assert.ok(result.includes(universalVersion));
			assert.ok(result.includes(specificVersion));
		});

		test('should include all non-compatible platform versions', () => {
			const version1 = aExtensionVersion('1.0.0', TargetPlatform.WIN32_X64);
			const version2 = aExtensionVersion('1.0.0', TargetPlatform.DARWIN_X64);
			const version3 = aPreReleaseExtensionVersion('1.1.0', TargetPlatform.LINUX_X64);
			const versions = [version1, version2, version3];
			const allTargetPlatforms = [TargetPlatform.WIN32_X64, TargetPlatform.DARWIN_X64, TargetPlatform.LINUX_X64];

			const result = filterLatestExtensionVersionsForTargetPlatform(versions, TargetPlatform.WIN32_X64, allTargetPlatforms);

			assert.ok(result.includes(version2));
			assert.ok(result.includes(version3));
		});

		test('should prefer specific target platform over undefined when same version exists for both', () => {
			const undefinedVersion = aExtensionVersion('1.0.0');
			const specificVersion = aExtensionVersion('1.0.0', TargetPlatform.WIN32_X64);

			const versions = [undefinedVersion, specificVersion];
			const allTargetPlatforms = [TargetPlatform.WIN32_X64];

			const result = filterLatestExtensionVersionsForTargetPlatform(versions, TargetPlatform.WIN32_X64, allTargetPlatforms);

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0], specificVersion);
			assert.ok(!result.includes(undefinedVersion));
		});

		test('should replace undefined pre-release with specific platform pre-release', () => {
			const undefinedPreRelease = aPreReleaseExtensionVersion('1.0.0');
			const specificPreRelease = aPreReleaseExtensionVersion('1.0.0', TargetPlatform.WIN32_X64);

			const versions = [undefinedPreRelease, specificPreRelease];
			const allTargetPlatforms = [TargetPlatform.WIN32_X64];

			const result = filterLatestExtensionVersionsForTargetPlatform(versions, TargetPlatform.WIN32_X64, allTargetPlatforms);

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0], specificPreRelease);
			assert.ok(!result.includes(undefinedPreRelease));
		});

		test('should handle explicit UNIVERSAL platform', () => {
			const universalVersion = aExtensionVersion('1.0.0', TargetPlatform.UNIVERSAL);
			const specificVersion = aExtensionVersion('1.0.0', TargetPlatform.WIN32_X64);

			const versions = [universalVersion, specificVersion];
			const allTargetPlatforms = [TargetPlatform.WIN32_X64];

			const result = filterLatestExtensionVersionsForTargetPlatform(versions, TargetPlatform.WIN32_X64, allTargetPlatforms);

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0], specificVersion);
			assert.ok(!result.includes(universalVersion));
		});

		test('should handle both release and pre-release with same version replacement', () => {
			const undefinedPreRelease = aPreReleaseExtensionVersion('1.1.0');
			const specificPreRelease = aPreReleaseExtensionVersion('1.1.0', TargetPlatform.WIN32_X64);
			const undefinedRelease = aExtensionVersion('1.0.0');
			const specificRelease = aExtensionVersion('1.0.0', TargetPlatform.WIN32_X64);

			const versions = [undefinedPreRelease, specificPreRelease, undefinedRelease, specificRelease];
			const allTargetPlatforms = [TargetPlatform.WIN32_X64];

			const result = filterLatestExtensionVersionsForTargetPlatform(versions, TargetPlatform.WIN32_X64, allTargetPlatforms);

			assert.strictEqual(result.length, 2);
			assert.ok(result.includes(specificRelease));
			assert.ok(result.includes(specificPreRelease));
			assert.ok(!result.includes(undefinedRelease));
			assert.ok(!result.includes(undefinedPreRelease));
		});

		test('should not replace when specific platform is for different platform', () => {
			const undefinedVersion = aExtensionVersion('1.0.0');
			const specificVersionDarwin = aExtensionVersion('1.0.0', TargetPlatform.DARWIN_X64);

			const versions = [undefinedVersion, specificVersionDarwin];
			const allTargetPlatforms = [TargetPlatform.WIN32_X64, TargetPlatform.DARWIN_X64];

			const result = filterLatestExtensionVersionsForTargetPlatform(versions, TargetPlatform.WIN32_X64, allTargetPlatforms);

			assert.strictEqual(result.length, 2);
			assert.ok(result.includes(undefinedVersion));
			assert.ok(result.includes(specificVersionDarwin));
		});

		test('should handle replacement with non-compatible versions in between', () => {
			const undefinedVersion = aExtensionVersion('1.0.0');
			const specificVersion = aExtensionVersion('1.0.0', TargetPlatform.WIN32_X64);
			const nonCompatibleVersion = aExtensionVersion('0.9.0', TargetPlatform.LINUX_ARM64);

			const versions = [undefinedVersion, specificVersion, nonCompatibleVersion];
			const allTargetPlatforms = [TargetPlatform.WIN32_X64, TargetPlatform.DARWIN_X64];

			const result = filterLatestExtensionVersionsForTargetPlatform(versions, TargetPlatform.WIN32_X64, allTargetPlatforms);

			assert.strictEqual(result.length, 2);
			assert.ok(result.includes(specificVersion));
			assert.ok(result.includes(nonCompatibleVersion));
			assert.ok(!result.includes(undefinedVersion));
		});

		test('should filter versions for linux-x64 target platform with mixed universal and platform-specific versions', () => {
			const versions = [
				aPreReleaseExtensionVersion('0.15.0'),
				aExtensionVersion('0.14.0'),
				aExtensionVersion('0.6.0', TargetPlatform.LINUX_X64),
				aPreReleaseExtensionVersion('0.5.1', TargetPlatform.LINUX_X64),
			];
			const allTargetPlatforms = [TargetPlatform.LINUX_X64];

			const result = filterLatestExtensionVersionsForTargetPlatform(versions, TargetPlatform.LINUX_X64, allTargetPlatforms);

			assert.strictEqual(result.length, 2);
			assert.ok(result.includes(versions[0]));
			assert.ok(result.includes(versions[1]));
		});

	});
});



/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { TestStorageService, TestProductService } from '../../../../test/common/workbenchTestServices.js';
import { AuthenticationAccessService, IAuthenticationAccessService } from '../../browser/authenticationAccessService.js';
import { AllowedExtension } from '../../common/authentication.js';

suite('AuthenticationAccessService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let instantiationService: TestInstantiationService;
	let storageService: TestStorageService;
	let productService: IProductService & { trustedExtensionAuthAccess?: string[] | Record<string, string[]> };
	let authenticationAccessService: IAuthenticationAccessService;

	setup(() => {
		instantiationService = disposables.add(new TestInstantiationService());

		storageService = disposables.add(new TestStorageService());
		instantiationService.stub(IStorageService, storageService);

		productService = { ...TestProductService, trustedExtensionAuthAccess: undefined };
		instantiationService.stub(IProductService, productService);

		authenticationAccessService = disposables.add(instantiationService.createInstance(AuthenticationAccessService));
	});

	teardown(() => {
		if (productService) {
			productService.trustedExtensionAuthAccess = undefined;
		}
	});

	suite('isAccessAllowed', () => {
		test('returns undefined for unknown extension with no product configuration', () => {
			const result = authenticationAccessService.isAccessAllowed('github', 'user@example.com', 'unknown-extension');
			assert.strictEqual(result, undefined);
		});

		test('returns true for trusted extension from product.json (array format)', () => {
			productService.trustedExtensionAuthAccess = ['trusted-extension-1', 'trusted-extension-2'];

			const result = authenticationAccessService.isAccessAllowed('github', 'user@example.com', 'trusted-extension-1');
			assert.strictEqual(result, true);
		});

		test('returns true for trusted extension from product.json (object format)', () => {
			productService.trustedExtensionAuthAccess = {
				'github': ['github-extension'],
				'microsoft': ['microsoft-extension']
			};

			const result1 = authenticationAccessService.isAccessAllowed('github', 'user@example.com', 'github-extension');
			assert.strictEqual(result1, true);

			const result2 = authenticationAccessService.isAccessAllowed('microsoft', 'user@microsoft.com', 'microsoft-extension');
			assert.strictEqual(result2, true);
		});

		test('returns undefined for extension not in trusted list', () => {
			productService.trustedExtensionAuthAccess = ['trusted-extension'];

			const result = authenticationAccessService.isAccessAllowed('github', 'user@example.com', 'untrusted-extension');
			assert.strictEqual(result, undefined);
		});

		test('returns stored allowed state when extension is in storage', () => {
			authenticationAccessService.updateAllowedExtensions('github', 'user@example.com', [{
				id: 'stored-extension',
				name: 'Stored Extension',
				allowed: false
			}]);

			const result = authenticationAccessService.isAccessAllowed('github', 'user@example.com', 'stored-extension');
			assert.strictEqual(result, false);
		});

		test('returns true for extension in storage with allowed=true', () => {
			authenticationAccessService.updateAllowedExtensions('github', 'user@example.com', [{
				id: 'allowed-extension',
				name: 'Allowed Extension',
				allowed: true
			}]);

			const result = authenticationAccessService.isAccessAllowed('github', 'user@example.com', 'allowed-extension');
			assert.strictEqual(result, true);
		});

		test('returns true for extension in storage with undefined allowed property (legacy behavior)', () => {
			const legacyExtension: AllowedExtension = {
				id: 'legacy-extension',
				name: 'Legacy Extension'
			};

			authenticationAccessService.updateAllowedExtensions('github', 'user@example.com', [legacyExtension]);

			const result = authenticationAccessService.isAccessAllowed('github', 'user@example.com', 'legacy-extension');
			assert.strictEqual(result, true);
		});

		test('product.json trusted extensions take precedence over storage', () => {
			productService.trustedExtensionAuthAccess = ['product-trusted-extension'];

			authenticationAccessService.updateAllowedExtensions('github', 'user@example.com', [{
				id: 'product-trusted-extension',
				name: 'Product Trusted Extension',
				allowed: false
			}]);

			const result = authenticationAccessService.isAccessAllowed('github', 'user@example.com', 'product-trusted-extension');
			assert.strictEqual(result, true);
		});
	});

	suite('readAllowedExtensions', () => {
		test('returns empty array when no data exists', () => {
			const result = authenticationAccessService.readAllowedExtensions('github', 'user@example.com');
			assert.strictEqual(result.length, 0);
		});

		test('returns stored extensions', () => {
			const extensions: AllowedExtension[] = [
				{ id: 'extension1', name: 'Extension 1', allowed: true },
				{ id: 'extension2', name: 'Extension 2', allowed: false }
			];

			authenticationAccessService.updateAllowedExtensions('github', 'user@example.com', extensions);

			const result = authenticationAccessService.readAllowedExtensions('github', 'user@example.com');
			assert.strictEqual(result.length, 2);
			assert.strictEqual(result[0].id, 'extension1');
			assert.strictEqual(result[0].allowed, true);
			assert.strictEqual(result[1].id, 'extension2');
			assert.strictEqual(result[1].allowed, false);
		});

		test('includes trusted extensions from product.json (array format)', () => {
			productService.trustedExtensionAuthAccess = ['trusted-extension-1', 'trusted-extension-2'];

			const result = authenticationAccessService.readAllowedExtensions('github', 'user@example.com');
			assert.strictEqual(result.length, 2);

			const trustedExtension1 = result.find(e => e.id === 'trusted-extension-1');
			assert.ok(trustedExtension1);
			assert.strictEqual(trustedExtension1.allowed, true);
			assert.strictEqual(trustedExtension1.trusted, true);
			assert.strictEqual(trustedExtension1.name, 'trusted-extension-1');

			const trustedExtension2 = result.find(e => e.id === 'trusted-extension-2');
			assert.ok(trustedExtension2);
			assert.strictEqual(trustedExtension2.allowed, true);
			assert.strictEqual(trustedExtension2.trusted, true);
		});

		test('includes trusted extensions from product.json (object format)', () => {
			productService.trustedExtensionAuthAccess = {
				'github': ['github-extension'],
				'microsoft': ['microsoft-extension']
			};

			const githubResult = authenticationAccessService.readAllowedExtensions('github', 'user@example.com');
			assert.strictEqual(githubResult.length, 1);
			assert.strictEqual(githubResult[0].id, 'github-extension');
			assert.strictEqual(githubResult[0].trusted, true);

			const microsoftResult = authenticationAccessService.readAllowedExtensions('microsoft', 'user@microsoft.com');
			assert.strictEqual(microsoftResult.length, 1);
			assert.strictEqual(microsoftResult[0].id, 'microsoft-extension');
			assert.strictEqual(microsoftResult[0].trusted, true);

			const unknownResult = authenticationAccessService.readAllowedExtensions('unknown', 'user@unknown.com');
			assert.strictEqual(unknownResult.length, 0);
		});

		test('merges stored extensions with trusted extensions from product.json', () => {
			productService.trustedExtensionAuthAccess = ['trusted-extension'];

			authenticationAccessService.updateAllowedExtensions('github', 'user@example.com', [
				{ id: 'stored-extension', name: 'Stored Extension', allowed: false }
			]);

			const result = authenticationAccessService.readAllowedExtensions('github', 'user@example.com');
			assert.strictEqual(result.length, 2);

			const trustedExtension = result.find(e => e.id === 'trusted-extension');
			assert.ok(trustedExtension);
			assert.strictEqual(trustedExtension.trusted, true);
			assert.strictEqual(trustedExtension.allowed, true);

			const storedExtension = result.find(e => e.id === 'stored-extension');
			assert.ok(storedExtension);
			assert.strictEqual(storedExtension.trusted, undefined);
			assert.strictEqual(storedExtension.allowed, false);
		});

		test('updates existing stored extension to trusted when found in product.json', () => {
			authenticationAccessService.updateAllowedExtensions('github', 'user@example.com', [
				{ id: 'extension1', name: 'Extension 1', allowed: false }
			]);

			productService.trustedExtensionAuthAccess = ['extension1'];

			const result = authenticationAccessService.readAllowedExtensions('github', 'user@example.com');
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].id, 'extension1');
			assert.strictEqual(result[0].trusted, true);
			assert.strictEqual(result[0].allowed, true);
		});

		test('handles malformed storage data gracefully', () => {
			storageService.store('github-user@example.com', 'invalid-json', StorageScope.APPLICATION, StorageTarget.USER);

			const result = authenticationAccessService.readAllowedExtensions('github', 'user@example.com');
			assert.strictEqual(result.length, 0);
		});
	});

	suite('updateAllowedExtensions', () => {
		test('adds new extensions to storage', () => {
			const extensions: AllowedExtension[] = [
				{ id: 'extension1', name: 'Extension 1', allowed: true },
				{ id: 'extension2', name: 'Extension 2', allowed: false }
			];

			authenticationAccessService.updateAllowedExtensions('github', 'user@example.com', extensions);

			const result = authenticationAccessService.readAllowedExtensions('github', 'user@example.com');
			assert.strictEqual(result.length, 2);
			assert.strictEqual(result[0].id, 'extension1');
			assert.strictEqual(result[1].id, 'extension2');
		});

		test('updates existing extension allowed status', () => {
			authenticationAccessService.updateAllowedExtensions('github', 'user@example.com', [
				{ id: 'extension1', name: 'Extension 1', allowed: true }
			]);

			authenticationAccessService.updateAllowedExtensions('github', 'user@example.com', [
				{ id: 'extension1', name: 'Extension 1', allowed: false }
			]);

			const result = authenticationAccessService.readAllowedExtensions('github', 'user@example.com');
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].allowed, false);
		});

		test('updates existing extension name when new name is provided', () => {
			authenticationAccessService.updateAllowedExtensions('github', 'user@example.com', [
				{ id: 'extension1', name: 'extension1', allowed: true }
			]);

			authenticationAccessService.updateAllowedExtensions('github', 'user@example.com', [
				{ id: 'extension1', name: 'My Extension', allowed: true }
			]);

			const result = authenticationAccessService.readAllowedExtensions('github', 'user@example.com');
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].name, 'My Extension');
		});

		test('does not update name when new name is same as ID', () => {
			authenticationAccessService.updateAllowedExtensions('github', 'user@example.com', [
				{ id: 'extension1', name: 'My Extension', allowed: true }
			]);

			authenticationAccessService.updateAllowedExtensions('github', 'user@example.com', [
				{ id: 'extension1', name: 'extension1', allowed: false }
			]);

			const result = authenticationAccessService.readAllowedExtensions('github', 'user@example.com');
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].name, 'My Extension');
			assert.strictEqual(result[0].allowed, false);
		});

		test('does not store trusted extensions - they should only come from product.json', () => {
			productService.trustedExtensionAuthAccess = ['trusted-extension'];

			authenticationAccessService.updateAllowedExtensions('github', 'user@example.com', [
				{ id: 'regular-extension', name: 'Regular Extension', allowed: true },
				{ id: 'trusted-extension', name: 'Trusted Extension', allowed: false }
			]);

			const storedData = storageService.get('github-user@example.com', StorageScope.APPLICATION);
			assert.ok(storedData);
			const parsedData = JSON.parse(storedData);
			assert.strictEqual(parsedData.length, 1);
			assert.strictEqual(parsedData[0].id, 'regular-extension');

			const result = authenticationAccessService.readAllowedExtensions('github', 'user@example.com');
			assert.strictEqual(result.length, 2);

			const trustedExt = result.find(e => e.id === 'trusted-extension');
			assert.ok(trustedExt);
			assert.strictEqual(trustedExt.trusted, true);
			assert.strictEqual(trustedExt.allowed, true);

			const regularExt = result.find(e => e.id === 'regular-extension');
			assert.ok(regularExt);
			assert.strictEqual(regularExt.trusted, undefined);
			assert.strictEqual(regularExt.allowed, true);
		});

		test('filters out trusted extensions before storing', () => {
			productService.trustedExtensionAuthAccess = ['trusted-ext-1', 'trusted-ext-2'];

			const extensions: AllowedExtension[] = [
				{ id: 'regular-ext', name: 'Regular Extension', allowed: true },
				{ id: 'trusted-ext-1', name: 'Trusted Extension 1', allowed: false },
				{ id: 'another-regular-ext', name: 'Another Regular Extension', allowed: false },
				{ id: 'trusted-ext-2', name: 'Trusted Extension 2', allowed: true }
			];

			authenticationAccessService.updateAllowedExtensions('github', 'user@example.com', extensions);

			const storedData = storageService.get('github-user@example.com', StorageScope.APPLICATION);
			assert.ok(storedData);
			const parsedData = JSON.parse(storedData);
			assert.strictEqual(parsedData.length, 2);
			assert.ok(parsedData.find((e: AllowedExtension) => e.id === 'regular-ext'));
			assert.ok(parsedData.find((e: AllowedExtension) => e.id === 'another-regular-ext'));
			assert.ok(!parsedData.find((e: AllowedExtension) => e.id === 'trusted-ext-1'));
			assert.ok(!parsedData.find((e: AllowedExtension) => e.id === 'trusted-ext-2'));
		});

		test('fires onDidChangeExtensionSessionAccess event', () => {
			let eventFired = false;
			let eventData: { providerId: string; accountName: string } | undefined;

			const subscription = authenticationAccessService.onDidChangeExtensionSessionAccess(e => {
				eventFired = true;
				eventData = e;
			});
			disposables.add(subscription);

			authenticationAccessService.updateAllowedExtensions('github', 'user@example.com', [
				{ id: 'extension1', name: 'Extension 1', allowed: true }
			]);

			assert.strictEqual(eventFired, true);
			assert.ok(eventData);
			assert.strictEqual(eventData.providerId, 'github');
			assert.strictEqual(eventData.accountName, 'user@example.com');
		});
	});

	suite('removeAllowedExtensions', () => {
		test('removes all extensions from storage', () => {
			authenticationAccessService.updateAllowedExtensions('github', 'user@example.com', [
				{ id: 'extension1', name: 'Extension 1', allowed: true },
				{ id: 'extension2', name: 'Extension 2', allowed: false }
			]);

			const result = authenticationAccessService.readAllowedExtensions('github', 'user@example.com');
			assert.ok(result.length > 0);

			authenticationAccessService.removeAllowedExtensions('github', 'user@example.com');

			const storedData = storageService.get('github-user@example.com', StorageScope.APPLICATION);
			assert.strictEqual(storedData, undefined);
		});

		test('fires onDidChangeExtensionSessionAccess event', () => {
			let eventFired = false;
			let eventData: { providerId: string; accountName: string } | undefined;

			authenticationAccessService.updateAllowedExtensions('github', 'user@example.com', [
				{ id: 'extension1', name: 'Extension 1', allowed: true }
			]);

			const subscription = authenticationAccessService.onDidChangeExtensionSessionAccess(e => {
				eventFired = true;
				eventData = e;
			});
			disposables.add(subscription);

			authenticationAccessService.removeAllowedExtensions('github', 'user@example.com');

			assert.strictEqual(eventFired, true);
			assert.ok(eventData);
			assert.strictEqual(eventData.providerId, 'github');
			assert.strictEqual(eventData.accountName, 'user@example.com');
		});

		test('does not affect trusted extensions from product.json', () => {
			productService.trustedExtensionAuthAccess = ['trusted-extension'];

			authenticationAccessService.updateAllowedExtensions('github', 'user@example.com', [
				{ id: 'regular-extension', name: 'Regular Extension', allowed: true }
			]);

			let result = authenticationAccessService.readAllowedExtensions('github', 'user@example.com');
			assert.strictEqual(result.length, 2);

			authenticationAccessService.removeAllowedExtensions('github', 'user@example.com');

			result = authenticationAccessService.readAllowedExtensions('github', 'user@example.com');
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].id, 'trusted-extension');
			assert.strictEqual(result[0].trusted, true);
		});
	});

	suite('integration with product.json configurations', () => {
		test('handles switching between array and object format', () => {
			productService.trustedExtensionAuthAccess = ['ext1', 'ext2'];
			let result = authenticationAccessService.readAllowedExtensions('github', 'user@example.com');
			assert.strictEqual(result.length, 2);

			productService.trustedExtensionAuthAccess = {
				'github': ['ext1', 'ext3'],
				'microsoft': ['ext4']
			};
			result = authenticationAccessService.readAllowedExtensions('github', 'user@example.com');
			assert.strictEqual(result.length, 2);
			assert.ok(result.find(e => e.id === 'ext1'));
			assert.ok(result.find(e => e.id === 'ext3'));
			assert.ok(!result.find(e => e.id === 'ext2'));
		});

		test('handles empty trusted extension configurations', () => {
			productService.trustedExtensionAuthAccess = undefined;
			let result = authenticationAccessService.readAllowedExtensions('github', 'user@example.com');
			assert.strictEqual(result.length, 0);

			productService.trustedExtensionAuthAccess = [];
			result = authenticationAccessService.readAllowedExtensions('github', 'user@example.com');
			assert.strictEqual(result.length, 0);

			productService.trustedExtensionAuthAccess = {};
			result = authenticationAccessService.readAllowedExtensions('github', 'user@example.com');
			assert.strictEqual(result.length, 0);
		});
	});
});

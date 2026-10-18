/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../../platform/extensions/common/extensions.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { NullExtensionService, nullExtensionDescription } from '../../../../services/extensions/common/extensions.js';
import { EXTENSION_ENABLED_CONTEXT_KEY_PREFIX, ExtensionEnablementContextKeysContribution } from '../../browser/extensionEnablementContext.js';

type ExtensionsChangeEvent = { readonly added: readonly IExtensionDescription[]; readonly removed: readonly IExtensionDescription[] };

function aExtension(id: string): IExtensionDescription {
	return { ...nullExtensionDescription, identifier: new ExtensionIdentifier(id) };
}

class TestExtensionService extends NullExtensionService {
	private readonly _onDidChangeExtensions = new Emitter<ExtensionsChangeEvent>();
	override readonly onDidChangeExtensions: Event<ExtensionsChangeEvent> = this._onDidChangeExtensions.event;

	constructor(initial: IExtensionDescription[]) {
		super();
		(this.extensions as IExtensionDescription[]).push(...initial);
	}

	fireChange(added: IExtensionDescription[], removed: IExtensionDescription[]): void {
		const extensions = this.extensions as IExtensionDescription[];
		for (const toRemove of removed) {
			const index = extensions.findIndex(e => ExtensionIdentifier.equals(e.identifier, toRemove.identifier));
			if (index !== -1) {
				extensions.splice(index, 1);
			}
		}
		extensions.push(...added);
		this._onDidChangeExtensions.fire({ added, removed });
	}

	setExtensionsAndFire(finalExtensions: IExtensionDescription[], event: ExtensionsChangeEvent): void {
		const extensions = this.extensions as IExtensionDescription[];
		extensions.length = 0;
		extensions.push(...finalExtensions);
		this._onDidChangeExtensions.fire(event);
	}

	dispose(): void {
		this._onDidChangeExtensions.dispose();
	}
}

suite('ExtensionEnablementContextKeysContribution', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function snapshot(contextKeyService: MockContextKeyService, ids: string[]): Record<string, boolean | undefined> {
		const result: Record<string, boolean | undefined> = {};
		for (const id of ids) {
			result[id] = contextKeyService.getContextKeyValue(EXTENSION_ENABLED_CONTEXT_KEY_PREFIX + id);
		}
		return result;
	}

	function createContribution(initial: IExtensionDescription[]): { contextKeyService: MockContextKeyService; extensionService: TestExtensionService } {
		const extensionService = new TestExtensionService(initial);
		disposables.add({ dispose: () => extensionService.dispose() });
		const contextKeyService = disposables.add(new MockContextKeyService());
		disposables.add(new ExtensionEnablementContextKeysContribution(contextKeyService, extensionService));
		return { contextKeyService, extensionService };
	}

	test('reflects installed-and-enabled extensions and reacts to changes', () => {
		const { contextKeyService, extensionService } = createContribution([aExtension('pub.a'), aExtension('pub.b')]);

		assert.deepStrictEqual(snapshot(contextKeyService, ['pub.a', 'pub.b', 'pub.c']), {
			'pub.a': true,
			'pub.b': true,
			'pub.c': undefined,
		});

		extensionService.fireChange([aExtension('pub.c')], []);
		extensionService.fireChange([], [aExtension('pub.b')]);
		extensionService.fireChange([aExtension('pub.a')], [aExtension('pub.a')]);

		assert.deepStrictEqual(snapshot(contextKeyService, ['pub.a', 'pub.b', 'pub.c']), {
			'pub.a': true,
			'pub.b': false,
			'pub.c': true,
		});
	});

	test('normalizes extension id to lower case', () => {
		const { contextKeyService } = createContribution([aExtension('Pub.MixedCase')]);

		assert.strictEqual(contextKeyService.getContextKeyValue(EXTENSION_ENABLED_CONTEXT_KEY_PREFIX + 'pub.mixedcase'), true);
	});

	test('reconciles against the final registry, not the change delta', () => {
		const { contextKeyService, extensionService } = createContribution([aExtension('pub.a')]);

		extensionService.setExtensionsAndFire([], { added: [aExtension('pub.a')], removed: [] });

		assert.strictEqual(contextKeyService.getContextKeyValue(EXTENSION_ENABLED_CONTEXT_KEY_PREFIX + 'pub.a'), false);
	});
});

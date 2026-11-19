/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ConfigKey, ConfigKeyType, DefaultsOnlyConfigProvider, InMemoryConfigProvider } from '../../../lib/src/config';
import { VSCodeConfigProvider } from '../config';

export class ExtensionTestConfigProvider extends InMemoryConfigProvider {
	private readonly vscConfigProvider = new VSCodeConfigProvider();

	constructor() {
		super(new DefaultsOnlyConfigProvider());
	}

	override getConfig<T>(key: ConfigKeyType): T {
		if (key === ConfigKey.DebugTestOverrideProxyUrl) {
			return this.vscConfigProvider.getConfig<T>(key);
		}
		return super.getConfig(key);
	}
}

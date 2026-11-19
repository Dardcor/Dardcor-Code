/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isNonEmptyArray } from '../../../../base/common/arrays.js';
import { localize } from '../../../../nls.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ExtensionIdentifier, IExtensionDescription, IExtensionManifest } from '../../../../platform/extensions/common/extensions.js';
import { allApiProposals, ApiProposalName } from '../../../../platform/extensions/common/extensionsApiProposals.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchEnvironmentService } from '../../environment/common/environmentService.js';
import { Extensions, IExtensionFeatureMarkdownRenderer, IExtensionFeaturesRegistry, IRenderedData } from '../../extensionManagement/common/extensionFeatures.js';
import { IMarkdownString, MarkdownString } from '../../../../base/common/htmlContent.js';
import { Mutable } from '../../../../base/common/types.js';

export class ExtensionsProposedApi {

	private readonly _envEnablesProposedApiForAll: boolean;
	private readonly _envEnabledExtensions: Set<string>;
	private readonly _productEnabledExtensions: Map<string, string[]>;

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@IProductService productService: IProductService
	) {

		this._envEnabledExtensions = new Set((_environmentService.extensionEnabledProposedApi ?? []).map(id => ExtensionIdentifier.toKey(id)));

		this._envEnablesProposedApiForAll =
			!_environmentService.isBuilt ||
			(_environmentService.isExtensionDevelopment && productService.quality !== 'stable') ||
			(this._envEnabledExtensions.size === 0 && Array.isArray(_environmentService.extensionEnabledProposedApi));

		this._productEnabledExtensions = new Map<string, ApiProposalName[]>();


		if (productService.extensionEnabledApiProposals) {
			for (const [k, value] of Object.entries(productService.extensionEnabledApiProposals)) {
				const key = ExtensionIdentifier.toKey(k);
				const proposalNames = value.filter(name => {
					if (!allApiProposals[<ApiProposalName>name]) {
						_logService.warn(`Via 'product.json#extensionEnabledApiProposals' extension '${key}' wants API proposal '${name}' but that proposal DOES NOT EXIST. Likely, the proposal has been finalized (check 'vscode.d.ts') or was abandoned.`);
						return false;
					}
					return true;
				});
				this._productEnabledExtensions.set(key, proposalNames);
			}
		}
	}

	updateEnabledApiProposals(extensions: IExtensionDescription[]): void {
		for (const extension of extensions) {
			this.doUpdateEnabledApiProposals(extension);
		}
	}

	private doUpdateEnabledApiProposals(extension: Mutable<IExtensionDescription>): void {

		const key = ExtensionIdentifier.toKey(extension.identifier);

		if (isNonEmptyArray(extension.enabledApiProposals)) {
			extension.enabledApiProposals = extension.enabledApiProposals.filter(name => {
				const result = Boolean(allApiProposals[<ApiProposalName>name]);
				if (!result) {
					this._logService.error(`Extension '${key}' wants API proposal '${name}' but that proposal DOES NOT EXIST. Likely, the proposal has been finalized (check 'vscode.d.ts') or was abandoned.`);
				}
				return result;
			});
		}


		if (this._productEnabledExtensions.has(key)) {

			const productEnabledProposals = this._productEnabledExtensions.get(key)!;

			const productSet = new Set(productEnabledProposals);
			const extensionSet = new Set(extension.enabledApiProposals);
			const diff = new Set([...extensionSet].filter(a => !productSet.has(a)));
			if (diff.size > 0) {
				this._logService.error(`Extension '${key}' appears in product.json but enables LESS API proposals than the extension wants.\npackage.json (LOSES): ${[...extensionSet].join('\n')}\nproduct.json (WINS): ${[...productSet].join('\n')}\nDELTA: ${[...diff].join('\n')}`);

				if (this._environmentService.isExtensionDevelopment) {
					this._logService.error(`Proceeding with EXTRA proposals (${[...diff].join(', ')}) because extension is in development mode. Still, this EXTENSION WILL BE BROKEN unless product.json is updated.`);
					productEnabledProposals.push(...diff);
				}
			}

			extension.enabledApiProposals = productEnabledProposals;
			return;
		}

		if (this._envEnablesProposedApiForAll || this._envEnabledExtensions.has(key)) {
			return;
		}

		if (!extension.isBuiltin && isNonEmptyArray(extension.enabledApiProposals)) {
			this._logService.error(`Extension '${extension.identifier.value} CANNOT USE these API proposals '${extension.enabledApiProposals?.join(', ') || '*'}'. You MUST start in extension development mode or use the --enable-proposed-api command line flag`);
			extension.enabledApiProposals = [];
		}
	}
}

class ApiProposalsMarkdowneRenderer extends Disposable implements IExtensionFeatureMarkdownRenderer {

	readonly type = 'markdown';

	shouldRender(manifest: IExtensionManifest): boolean {
		return !!manifest.originalEnabledApiProposals?.length || !!manifest.enabledApiProposals?.length;
	}

	render(manifest: IExtensionManifest): IRenderedData<IMarkdownString> {
		const enabledApiProposals = manifest.originalEnabledApiProposals ?? manifest.enabledApiProposals ?? [];
		const data = new MarkdownString();
		if (enabledApiProposals.length) {
			for (const proposal of enabledApiProposals) {
				data.appendMarkdown(`- \`${proposal}\`\n`);
			}
		}
		return {
			data,
			dispose: () => { }
		};
	}
}

Registry.as<IExtensionFeaturesRegistry>(Extensions.ExtensionFeaturesRegistry).registerExtensionFeature({
	id: 'enabledApiProposals',
	label: localize('enabledProposedAPIs', "API Proposals"),
	access: {
		canToggle: false
	},
	renderer: new SyncDescriptor(ApiProposalsMarkdowneRenderer),
});

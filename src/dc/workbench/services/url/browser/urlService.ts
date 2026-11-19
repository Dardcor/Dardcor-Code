/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IURLService } from '../../../../platform/url/common/url.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { AbstractURLService } from '../../../../platform/url/common/urlService.js';
import { Event } from '../../../../base/common/event.js';
import { IBrowserWorkbenchEnvironmentService } from '../../environment/browser/environmentService.js';
import { IOpenerService, IOpener, OpenExternalOptions, OpenInternalOptions } from '../../../../platform/opener/common/opener.js';
import { matchesScheme } from '../../../../base/common/network.js';
import { IProductService } from '../../../../platform/product/common/productService.js';

export interface IURLCallbackProvider {

	readonly onCallback: Event<URI>;

	create(options?: Partial<UriComponents>): URI;
}

class BrowserURLOpener implements IOpener {

	constructor(
		private urlService: IURLService,
		private productService: IProductService
	) { }

	async open(resource: string | URI, options?: OpenInternalOptions | OpenExternalOptions): Promise<boolean> {
		if ((options as OpenExternalOptions | undefined)?.openExternal) {
			return false;
		}

		if (!matchesScheme(resource, this.productService.urlProtocol)) {
			return false;
		}

		if (typeof resource === 'string') {
			resource = URI.parse(resource);
		}

		return this.urlService.open(resource, { trusted: true });
	}
}

export class BrowserURLService extends AbstractURLService {

	private provider: IURLCallbackProvider | undefined;

	constructor(
		@IBrowserWorkbenchEnvironmentService environmentService: IBrowserWorkbenchEnvironmentService,
		@IOpenerService openerService: IOpenerService,
		@IProductService productService: IProductService
	) {
		super();

		this.provider = environmentService.options?.urlCallbackProvider;

		if (this.provider) {
			this._register(this.provider.onCallback(uri => this.open(uri, { trusted: true })));
		}

		this._register(openerService.registerOpener(new BrowserURLOpener(this, productService)));
	}

	create(options?: Partial<UriComponents>): URI {
		if (this.provider) {
			return this.provider.create(options);
		}

		return URI.parse('unsupported://');
	}
}

registerSingleton(IURLService, BrowserURLService, InstantiationType.Delayed);

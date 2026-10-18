/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore } from '../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { BrowserView } from './browserView.js';
import { ICDPTarget, CDPBrowserVersion, CDPWindowBounds, CDPTargetInfo, ICDPConnection, ICDPBrowserTarget, CDPRequest, CDPResponse, CDPEvent } from '../common/cdp/types.js';
import { CDPBrowserProxy } from '../common/cdp/proxy.js';
import { IBrowserViewGroup, IBrowserViewGroupViewEvent } from '../common/browserViewGroup.js';
import { IBrowserViewOwner } from '../common/browserView.js';
import { IBrowserViewMainService } from './browserViewMainService.js';
import { IProductService } from '../../product/common/productService.js';
import { BrowserSession } from './browserSession.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { BrowserViewCDPTarget } from './browserViewCDPTarget.js';
import { IInstantiationService } from '../../instantiation/common/instantiation.js';

export class BrowserViewGroup extends Disposable implements ICDPBrowserTarget, IBrowserViewGroup {

	private readonly views = new Map<string, BrowserView>();
	private readonly viewTargets = this._register(new DisposableMap<string, BrowserViewCDPTarget>());

	private readonly knownContextIds = new Set<string>();
	private readonly ownedContextIds = new Set<string>();

	private readonly _onDidAddView = this._register(new Emitter<IBrowserViewGroupViewEvent>());
	readonly onDidAddView: Event<IBrowserViewGroupViewEvent> = this._onDidAddView.event;

	private readonly _onDidRemoveView = this._register(new Emitter<IBrowserViewGroupViewEvent>());
	readonly onDidRemoveView: Event<IBrowserViewGroupViewEvent> = this._onDidRemoveView.event;

	private readonly _onDidDestroy = this._register(new Emitter<void>());
	readonly onDidDestroy: Event<void> = this._onDidDestroy.event;

	readonly debugger = this._register(new CDPBrowserProxy(this));

	constructor(
		readonly id: string,
		readonly owner: IBrowserViewOwner,
		@IBrowserViewMainService private readonly browserViewMainService: IBrowserViewMainService,
		@IProductService private readonly productService: IProductService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
	}

	get onCDPMessage(): Event<CDPResponse | CDPEvent> {
		return this.debugger.onMessage;
	}

	sendCDPMessage(msg: CDPRequest): Promise<void> {
		return this.debugger.sendMessage(msg);
	}


	async addView(viewId: string): Promise<void> {
		if (this.views.has(viewId)) {
			return;
		}
		const view = this.browserViewMainService.tryGetBrowserView(viewId);
		if (!view) {
			throw new Error(`Browser view ${viewId} not found`);
		}
		this.views.set(view.id, view);
		this.knownContextIds.add(view.session.id);

		const closeListener = Event.once(view.onDidClose)(() => {
			this.removeView(viewId);
		});

		const info = await view.debugger.getTargetInfo();

		if (this.views.get(viewId) !== view) {
			closeListener.dispose();
			return;
		}

		this._onDidAddView.fire({ viewId: view.id, targetId: info.targetId, url: info.url, title: info.title });

		const target = new BrowserViewCDPTarget(view, info);
		this.viewTargets.set(view.id, target);

		const store = new DisposableStore();
		store.add(closeListener);
		target.onClose(() => store.dispose());

		this.debugger.registerTarget(target);

		for (const targetInfo of view.debugger.knownTargets.values()) {
			this.debugger.registerTarget(new BrowserViewCDPTarget(view, targetInfo));
		}
		store.add(view.debugger.onTargetDiscovered(targetInfo => {
			this.debugger.registerTarget(new BrowserViewCDPTarget(view, targetInfo));
		}));

		store.add(view.debugger.onSessionCreated(({ session, waitingForDebugger }) => {
			this.debugger.notifySessionCreated(session, waitingForDebugger);
		}));
	}

	async removeView(viewId: string): Promise<void> {
		const view = this.views.get(viewId);
		if (view && this.views.delete(viewId)) {
			if (!this.ownedContextIds.has(view.session.id) && ![...this.views.values()].some(v => v.session.id === view.session.id)) {
				this.knownContextIds.delete(view.session.id);
			}
			this._onDidRemoveView.fire({ viewId: view.id });
			this.viewTargets.deleteAndDispose(viewId);
		}
	}



	private readonly _onTargetInfoChanged = this._register(new Emitter<CDPTargetInfo>());
	readonly onTargetInfoChanged = this._onTargetInfoChanged.event;

	getVersion(): CDPBrowserVersion {
		return {
			protocolVersion: '1.3',
			product: `${this.productService.nameShort}/${this.productService.version}`,
			revision: this.productService.commit || 'unknown',
			userAgent: 'Electron',
			jsVersion: process.versions.v8
		};
	}

	getWindowForTarget(target: ICDPTarget): { windowId: number; bounds: CDPWindowBounds } {
		if (!(target instanceof BrowserViewCDPTarget)) {
			throw new Error('Can only get window for BrowserView targets');
		}

		const view = target.view.getWebContentsView();
		const viewBounds = view.getBounds();
		return {
			windowId: this.owner.mainWindowId ?? 0,
			bounds: {
				left: viewBounds.x,
				top: viewBounds.y,
				width: viewBounds.width,
				height: viewBounds.height,
				windowState: 'normal'
			}
		};
	}

	async attach(): Promise<ICDPConnection> {
		return new CDPBrowserProxy(this);
	}

	readonly sessions: ReadonlyMap<string, ICDPConnection> = new Map();
	readonly onSessionCreated = Event.None;
	readonly onClose: Event<void> = this._onDidDestroy.event;
	notifySessionCreated(): void { }

	get targetInfo(): CDPTargetInfo {
		return {
			targetId: this.id,
			type: 'browser',
			title: this.getVersion().product,
			url: '',
			attached: true,
			canAccessOpener: false
		};
	}

	async createTarget(url: string, browserContextId?: string): Promise<ICDPTarget> {
		if (browserContextId && !this.knownContextIds.has(browserContextId)) {
			throw new Error(`Unknown browser context ${browserContextId}`);
		}

		const target = await this.browserViewMainService.createTarget(url, this.owner, browserContextId);
		if (target instanceof BrowserView) {
			await this.addView(target.id);
			return this.viewTargets.get(target.id)!;
		}
		return target;
	}

	async activateTarget(target: ICDPTarget): Promise<void> {
		if (!(target instanceof BrowserViewCDPTarget)) {
			throw new Error('Can only activate BrowserView targets');
		}
	}

	async closeTarget(target: ICDPTarget): Promise<boolean> {
		if (!(target instanceof BrowserViewCDPTarget)) {
			throw new Error('Can only close BrowserView targets');
		}

		await this.removeView(target.view.id);
		await this.browserViewMainService.destroyBrowserView(target.view.id);
		return true;
	}


	getBrowserContexts(): string[] {
		return [...this.knownContextIds];
	}

	async createBrowserContext(): Promise<string> {
		const browserSession = BrowserSession.getOrCreateEphemeral(this.instantiationService, generateUuid(), 'cdp-created');
		const contextId = browserSession.id;
		this.knownContextIds.add(contextId);
		this.ownedContextIds.add(contextId);
		return contextId;
	}

	async disposeBrowserContext(browserContextId: string): Promise<void> {
		if (!this.ownedContextIds.has(browserContextId)) {
			throw new Error('Can only dispose browser contexts created by this group');
		}

		const viewIds = [...this.views.entries()]
			.filter(([, view]) => view.session.id === browserContextId)
			.map(([id]) => id);

		for (const viewId of viewIds) {
			await this.removeView(viewId);
			await this.browserViewMainService.destroyBrowserView(viewId);
		}

		this.knownContextIds.delete(browserContextId);
		this.ownedContextIds.delete(browserContextId);
	}


	override dispose(): void {
		this._onDidDestroy.fire();
		super.dispose();
	}
}

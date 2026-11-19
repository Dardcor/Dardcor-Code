/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { UntitledTextEditorModel, IUntitledTextEditorModel } from './untitledTextEditorModel.js';
import { IFilesConfiguration } from '../../../../platform/files/common/files.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { Schemas } from '../../../../base/common/network.js';
import { Disposable, DisposableResourceMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';

export const IUntitledTextEditorService = createDecorator<IUntitledTextEditorService>('untitledTextEditorService');

export interface INewUntitledTextEditorOptions {

	initialValue?: string;

	languageId?: string;

	encoding?: string;
}

export interface IExistingUntitledTextEditorOptions extends INewUntitledTextEditorOptions {

	untitledResource?: URI;
}

export interface INewUntitledTextEditorWithAssociatedResourceOptions extends INewUntitledTextEditorOptions {

	associatedResource?: { authority: string; path: string; query: string; fragment: string };
}

type IInternalUntitledTextEditorOptions = IExistingUntitledTextEditorOptions & INewUntitledTextEditorWithAssociatedResourceOptions;

export interface IUntitledTextEditorModelSaveEvent {

	readonly source: URI;

	readonly target: URI;
}

export interface IUntitledTextEditorService {

	readonly _serviceBrand: undefined;

	readonly onDidSave: Event<IUntitledTextEditorModelSaveEvent>;

	readonly onDidChangeDirty: Event<IUntitledTextEditorModel>;

	readonly onDidChangeEncoding: Event<IUntitledTextEditorModel>;

	readonly onDidChangeLabel: Event<IUntitledTextEditorModel>;

	readonly onDidCreate: Event<IUntitledTextEditorModel>;

	readonly onWillDispose: Event<IUntitledTextEditorModel>;

	create(options?: INewUntitledTextEditorOptions): IUntitledTextEditorModel;
	create(options?: INewUntitledTextEditorWithAssociatedResourceOptions): IUntitledTextEditorModel;
	create(options?: IExistingUntitledTextEditorOptions): IUntitledTextEditorModel;

	get(resource: URI): IUntitledTextEditorModel | undefined;

	getValue(resource: URI): string | undefined;

	resolve(options?: INewUntitledTextEditorOptions): Promise<IUntitledTextEditorModel>;
	resolve(options?: INewUntitledTextEditorWithAssociatedResourceOptions): Promise<IUntitledTextEditorModel>;
	resolve(options?: IExistingUntitledTextEditorOptions): Promise<IUntitledTextEditorModel>;

	isUntitledWithAssociatedResource(resource: URI): boolean;

	canDispose(model: IUntitledTextEditorModel): true | Promise<true>;
}

export interface IUntitledTextEditorModelManager extends IUntitledTextEditorService {

	notifyDidSave(source: URI, target: URI): void;
}

export class UntitledTextEditorService extends Disposable implements IUntitledTextEditorModelManager {

	declare readonly _serviceBrand: undefined;

	private static readonly UNTITLED_WITHOUT_ASSOCIATED_RESOURCE_REGEX = /Untitled-\d+/;

	private readonly _onDidSave = this._register(new Emitter<IUntitledTextEditorModelSaveEvent>());
	readonly onDidSave = this._onDidSave.event;

	private readonly _onDidChangeDirty = this._register(new Emitter<IUntitledTextEditorModel>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	private readonly _onDidChangeEncoding = this._register(new Emitter<IUntitledTextEditorModel>());
	readonly onDidChangeEncoding = this._onDidChangeEncoding.event;

	private readonly _onDidCreate = this._register(new Emitter<IUntitledTextEditorModel>());
	readonly onDidCreate = this._onDidCreate.event;

	private readonly _onWillDispose = this._register(new Emitter<IUntitledTextEditorModel>());
	readonly onWillDispose = this._onWillDispose.event;

	private readonly _onDidChangeLabel = this._register(new Emitter<IUntitledTextEditorModel>());
	readonly onDidChangeLabel = this._onDidChangeLabel.event;

	private readonly mapResourceToModel = this._register(new DisposableResourceMap<UntitledTextEditorModel>());

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
	}

	get(resource: URI): UntitledTextEditorModel | undefined {
		return this.mapResourceToModel.get(resource);
	}

	getValue(resource: URI): string | undefined {
		return this.get(resource)?.textEditorModel?.getValue();
	}

	async resolve(options?: IInternalUntitledTextEditorOptions): Promise<UntitledTextEditorModel> {
		const model = this.doCreateOrGet(options);
		await model.resolve();

		return model;
	}

	create(options?: IInternalUntitledTextEditorOptions): UntitledTextEditorModel {
		return this.doCreateOrGet(options);
	}

	private doCreateOrGet(options: IInternalUntitledTextEditorOptions = Object.create(null)): UntitledTextEditorModel {
		const massagedOptions = this.massageOptions(options);

		if (massagedOptions.untitledResource && this.mapResourceToModel.has(massagedOptions.untitledResource)) {
			return this.mapResourceToModel.get(massagedOptions.untitledResource)!;
		}

		return this.doCreate(massagedOptions);
	}

	private massageOptions(options: IInternalUntitledTextEditorOptions): IInternalUntitledTextEditorOptions {
		const massagedOptions: IInternalUntitledTextEditorOptions = Object.create(null);

		if (options.associatedResource) {
			massagedOptions.untitledResource = URI.from({
				scheme: Schemas.untitled,
				authority: options.associatedResource.authority,
				fragment: options.associatedResource.fragment,
				path: options.associatedResource.path,
				query: options.associatedResource.query
			});
			massagedOptions.associatedResource = options.associatedResource;
		} else {
			if (options.untitledResource?.scheme === Schemas.untitled) {
				massagedOptions.untitledResource = options.untitledResource;
			}
		}

		if (options.languageId) {
			massagedOptions.languageId = options.languageId;
		} else if (!massagedOptions.associatedResource) {
			const configuration = this.configurationService.getValue<IFilesConfiguration>();
			if (configuration.files?.defaultLanguage) {
				massagedOptions.languageId = configuration.files.defaultLanguage;
			}
		}

		massagedOptions.encoding = options.encoding;
		massagedOptions.initialValue = options.initialValue;

		return massagedOptions;
	}

	private doCreate(options: IInternalUntitledTextEditorOptions): UntitledTextEditorModel {

		let untitledResource = options.untitledResource;
		if (!untitledResource) {
			let counter = 1;
			do {
				untitledResource = URI.from({ scheme: Schemas.untitled, path: `Untitled-${counter}` });
				counter++;
			} while (this.mapResourceToModel.has(untitledResource));
		}

		const model = this.instantiationService.createInstance(UntitledTextEditorModel, untitledResource, !!options.associatedResource, options.initialValue, options.languageId, options.encoding);

		this.registerModel(model);

		return model;
	}

	private registerModel(model: UntitledTextEditorModel): void {

		const modelListeners = new DisposableStore();
		modelListeners.add(model.onDidChangeDirty(() => this._onDidChangeDirty.fire(model)));
		modelListeners.add(model.onDidChangeName(() => this._onDidChangeLabel.fire(model)));
		modelListeners.add(model.onDidChangeEncoding(() => this._onDidChangeEncoding.fire(model)));
		modelListeners.add(model.onWillDispose(() => this._onWillDispose.fire(model)));

		Event.once(model.onWillDispose)(() => {

			this.mapResourceToModel.deleteAndLeak(model.resource);

			modelListeners.dispose();
		});

		this.mapResourceToModel.set(model.resource, model);

		this._onDidCreate.fire(model);

		if (model.isDirty()) {
			this._onDidChangeDirty.fire(model);
		}
	}

	isUntitledWithAssociatedResource(resource: URI): boolean {
		return resource.scheme === Schemas.untitled && resource.path.length > 1 && !UntitledTextEditorService.UNTITLED_WITHOUT_ASSOCIATED_RESOURCE_REGEX.test(resource.path);
	}

	canDispose(model: UntitledTextEditorModel): true | Promise<true> {
		if (model.isDisposed()) {
			return true;
		}

		return this.doCanDispose(model);
	}

	private async doCanDispose(model: UntitledTextEditorModel): Promise<true> {

		if (model.isDirty()) {
			await Event.toPromise(model.onDidChangeDirty);

			return this.canDispose(model);
		}

		return true;
	}

	notifyDidSave(source: URI, target: URI): void {
		this._onDidSave.fire({ source, target });
	}
}

registerSingleton(IUntitledTextEditorService, UntitledTextEditorService, InstantiationType.Delayed);

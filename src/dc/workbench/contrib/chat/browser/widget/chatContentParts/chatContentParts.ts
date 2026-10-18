/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, ReferenceCollection } from '../../../../../../base/common/lifecycle.js';
import { ChatTreeItem, IChatCodeBlockInfo } from '../../chat.js';
import { IChatRendererContent, IChatRequestViewModel, IChatResponseViewModel } from '../../../common/model/chatViewModel.js';
import { DiffEditorPool, EditorPool } from './chatContentCodePools.js';
import { IObservable } from '../../../../../../base/common/observable.js';
import { Event } from '../../../../../../base/common/event.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import { ILanguageSelection } from '../../../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../../../editor/common/services/model.js';
import { URI } from '../../../../../../base/common/uri.js';

export interface IChatContentPart extends IDisposable {
	domNode: HTMLElement | undefined;

	codeblocksPartId?: string;

	codeblocks?: IChatCodeBlockInfo[];

	hasSameContent(other: IChatRendererContent, followingContent: IChatRendererContent[], element: ChatTreeItem): boolean;

	onDidRemount?(): void;

	addDisposable?(disposable: IDisposable): void;
}

export interface IChatContentPartDiffResource {
	readonly resource: URI;
	readonly originalURI: URI | undefined;
	readonly modifiedURI: URI | undefined;
}

export interface IChatContentPartDiffData {
	readonly added: number;
	readonly removed: number;
	readonly resources: readonly IChatContentPartDiffResource[];
}

export interface IChatContentPartRenderContext {
	readonly element: IChatRequestViewModel | IChatResponseViewModel;
	readonly elementIndex: number;
	readonly container: HTMLElement;
	readonly content: ReadonlyArray<IChatRendererContent>;
	readonly contentIndex: number;
	readonly editorPool: EditorPool;
	readonly codeBlockStartIndex: number;
	readonly treeStartIndex: number;
	readonly diffEditorPool: DiffEditorPool;
	readonly currentWidth: IObservable<number>;
	readonly onDidChangeVisibility: Event<boolean>;
	readonly inlineTextModels: InlineTextModelCollection;
}

export class InlineTextModelCollection extends Disposable {
	private readonly _collection: InlineTextModelReferenceCollection;

	constructor(@IModelService modelService: IModelService) {
		super();
		this._collection = new InlineTextModelReferenceCollection(modelService);
	}

	acquire(uri: URI, value: string, languageSelection: ILanguageSelection | null, isForSimpleWidget: boolean) {
		return this._collection.acquire(uri.toString(), uri, value, languageSelection, isForSimpleWidget);
	}
}

class InlineTextModelReferenceCollection extends ReferenceCollection<ITextModel> {
	constructor(private readonly modelService: IModelService) {
		super();
	}

	protected override createReferencedObject(key: string, uri: URI, value: string, languageSelection: ILanguageSelection | null, isForSimpleWidget: boolean): ITextModel {
		return this.modelService.createModel(value, languageSelection, uri, isForSimpleWidget);
	}

	protected override destroyReferencedObject(_key: string, model: ITextModel): void {
		model.dispose();
	}
}

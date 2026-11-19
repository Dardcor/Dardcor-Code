/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrandedService, IConstructorSignature } from '../../platform/instantiation/common/instantiation.js';

export interface IEditorFeature {
}

export type EditorFeatureCtor = IConstructorSignature<IEditorFeature>;

const editorFeatures: EditorFeatureCtor[] = [];

export function registerEditorFeature<Services extends BrandedService[]>(ctor: { new(...services: Services): IEditorFeature }): void {
	editorFeatures.push(ctor as EditorFeatureCtor);
}

export function getEditorFeatures(): Iterable<EditorFeatureCtor> {
	return editorFeatures.slice(0);
}

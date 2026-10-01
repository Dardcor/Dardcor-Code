import { URI } from '../../base/common/uri.js';
import type { ITextEditorOptions } from '../../platform/editor/common/editor.js';
import type { IRange } from './core/range.js';
export type IMultiDiffResourceId = {
    original: URI | undefined;
    modified: URI | undefined;
};
export interface IMultiDiffEditorOptions extends ITextEditorOptions {
    viewState?: IMultiDiffEditorOptionsViewState;
}
export interface IMultiDiffEditorOptionsViewState {
    revealData?: {
        resource: IMultiDiffResourceId;
        range?: IRange;
    };
}

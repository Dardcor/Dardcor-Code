import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostTreeView {
	private readonly _treeViews = new Map<string, any>();

	createTreeView(viewId: string, options: any): any {
		const treeView = {
			id: viewId,
			options,
			onDidCollapseElement: new Emitter<any>().event,
			onDidExpandElement: new Emitter<any>().event,
			onDidChangeSelection: new Emitter<any>().event,
			onDidChangeVisibility: new Emitter<any>().event,
			onDidChangeCheckboxState: new Emitter<any>().event,
			visible: false,
			selection: [],
			reveal: (element: any, options?: any) => Promise.resolve(),
			dispose: () => {
				this._treeViews.delete(viewId);
			},
			message: undefined,
			title: undefined,
			description: undefined,
			badge: undefined
		};
		this._treeViews.set(viewId, treeView);
		return treeView;
	}

	getTreeView(viewId: string): any | undefined {
		return this._treeViews.get(viewId);
	}
}

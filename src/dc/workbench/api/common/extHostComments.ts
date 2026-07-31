import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostComments {
	private readonly _commentControllers = new Map<string, any>();

	createCommentController(id: string, label: string): any {
		const controller = {
			id,
			label,
			options: {},
			commentingRangeProvider: undefined,
			reactionHandler: undefined,
			createCommentThread: (uri: any, range: any, comments: any[]) => {
				return {
					uri,
					range,
					comments,
					collapsibleState: 0,
					canReply: true,
					dispose: () => {}
				};
			},
			dispose: () => {
				this._commentControllers.delete(id);
			}
		};
		this._commentControllers.set(id, controller);
		return controller;
	}
}

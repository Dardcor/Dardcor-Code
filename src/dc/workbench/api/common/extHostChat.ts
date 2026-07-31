import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostChat {
	private readonly _chatParticipants = new Map<string, any>();

	registerChatParticipant(id: string, name: string, handler: any): IDisposable {
		const participant = { id, name, handler };
		this._chatParticipants.set(id, participant);

		return {
			dispose: () => {
				this._chatParticipants.delete(id);
			}
		};
	}

	registerChatVariableResolver(id: string, name: string, resolver: any): IDisposable {
		return { dispose: () => {} };
	}

	sendInteractiveRequestToProvider(providerId: string, message: string): Promise<any> {
		return Promise.resolve(undefined);
	}
}

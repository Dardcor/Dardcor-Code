import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostTestProfile {
	constructor(
		public readonly label: string,
		public readonly kind: number, // TestRunProfileKind
		public readonly runHandler: (request: any, token: any) => Thenable<void> | void,
		public readonly isDefault: boolean = false
	) {}
	
	public configureHandler?: () => void;
	public dispose(): void {}
}

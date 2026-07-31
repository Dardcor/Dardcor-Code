import { Emitter, Event } from '../../../../dc/core/common/event.js';

export interface IServerIssueData {
	readonly issueType: 'bug' | 'feature' | 'performance';
	readonly issueTitle: string;
	readonly issueDescription: string;
	readonly extensionId?: string;
	readonly includeSystemInfo?: boolean;
	readonly includeWorkspaceInfo?: boolean;
}

export interface IServerIssueService {
	readonly onDidOpenIssueReporter: Event<void>;
	readonly onDidSubmitIssue: Event<IServerIssueData>;
	openIssueReporter(data?: Partial<IServerIssueData>): Promise<void>;
	submitIssue(data: IServerIssueData): Promise<void>;
}

export class ServerIssueCommon implements IServerIssueService {
	private readonly _onDidOpenIssueReporter = new Emitter<void>();
	readonly onDidOpenIssueReporter = this._onDidOpenIssueReporter.event;

	private readonly _onDidSubmitIssue = new Emitter<IServerIssueData>();
	readonly onDidSubmitIssue = this._onDidSubmitIssue.event;

	async openIssueReporter(_data?: Partial<IServerIssueData>): Promise<void> {
		this._onDidOpenIssueReporter.fire();
	}

	async submitIssue(data: IServerIssueData): Promise<void> {
		this._onDidSubmitIssue.fire(data);
	}
}

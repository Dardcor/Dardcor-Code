import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostWorkspaceEdit {
	private readonly _edits = new Map<string, any[]>();
	
	replace(uri: any, range: any, newText: string, metadata?: any): void {
		// Mock implementation
	}

	insert(uri: any, position: any, newText: string, metadata?: any): void {
		// Mock implementation
	}

	delete(uri: any, range: any, metadata?: any): void {
		// Mock implementation
	}
}

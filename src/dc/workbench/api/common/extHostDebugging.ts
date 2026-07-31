import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';
import { ExtHostDebugService } from './extHostDebugService';
import { ExtHostDebugAdapter } from './extHostDebugAdapter';

export class ExtHostDebugging {
	readonly service = new ExtHostDebugService();
	readonly adapter = new ExtHostDebugAdapter();
	
	// Composite class for debugging capabilities
}

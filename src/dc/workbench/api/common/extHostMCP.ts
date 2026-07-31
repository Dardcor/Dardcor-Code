import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostMCP {
	private readonly _servers = new Map<string, any>();
	
	registerMCPServer(id: string, name: string, server: any): IDisposable {
		this._servers.set(id, server);
		return {
			dispose: () => {
				this._servers.delete(id);
			}
		};
	}

	async executeMCPTool(serverId: string, tool: string, args: any): Promise<any> {
		const server = this._servers.get(serverId);
		if (server) {
			return server.execute(tool, args);
		}
		throw new Error(`MCP server ${serverId} not found`);
	}
}

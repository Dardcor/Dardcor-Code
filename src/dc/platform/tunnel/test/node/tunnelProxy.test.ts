/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import type { IncomingHttpHeaders, Server } from 'http';
import type { AddressInfo } from 'net';
import type { TLSSocket } from 'tls';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import { ITunnelConnectFn, TunnelProxy } from '../../node/tunnelProxy.js';
import { ITunnelProxyInfo } from '../../common/tunnelProxy.js';
import { NodeSocket } from '../../../../base/parts/ipc/node/ipc.net.js';
import { ISocket, SocketCloseEvent, SocketCloseEventType } from '../../../../base/parts/ipc/common/ipc.net.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';

function mockTunnelProtocol(socket: import('net').Socket) {
	return {
		getSocket: () => new NodeSocket(socket),
		readEntireBuffer: () => VSBuffer.alloc(0),
		dispose: () => { },
	};
}

function createMockConnectFn(targetPort: number): ITunnelConnectFn {
	return async (_host: string, _port: number) => {
		const net = await import('net');
		const socket = net.createConnection({ host: '127.0.0.1', port: targetPort });
		await new Promise<void>((resolve, reject) => {
			socket.once('connect', resolve);
			socket.once('error', reject);
		});
		return mockTunnelProtocol(socket);
	};
}

class ManagedTestSocket extends Disposable implements ISocket {

	private readonly _onData = this._register(new Emitter<VSBuffer>());
	private readonly _onClose = this._register(new Emitter<SocketCloseEvent>());
	private readonly _onEnd = this._register(new Emitter<void>());

	private _isDisposed = false;
	get isDisposed(): boolean { return this._isDisposed; }

	constructor(private readonly _socket: import('net').Socket) {
		super();
		this._socket.on('data', d => this._onData.fire(VSBuffer.wrap(d)));
		this._socket.on('end', () => this._onEnd.fire());
		this._socket.on('close', hadError => this._onClose.fire({ type: SocketCloseEventType.NodeSocketCloseEvent, hadError, error: undefined }));
		this._socket.on('error', () => { });
	}

	onData(listener: (e: VSBuffer) => void): IDisposable { return this._onData.event(listener); }
	onClose(listener: (e: SocketCloseEvent) => void): IDisposable { return this._onClose.event(listener); }
	onEnd(listener: () => void): IDisposable { return this._onEnd.event(listener); }
	write(buffer: VSBuffer): void { this._socket.write(buffer.buffer); }
	end(): void { this._socket.end(); }
	drain(): Promise<void> { return Promise.resolve(); }
	traceSocketEvent(): void { }

	override dispose(): void {
		this._isDisposed = true;
		this._socket.destroy();
		super.dispose();
	}
}

function createManagedConnectFn(targetPort: number, onSocket?: (socket: ManagedTestSocket) => void): ITunnelConnectFn {
	return async () => {
		const net = await import('net');
		const socket = net.createConnection({ host: '127.0.0.1', port: targetPort });
		await new Promise<void>((resolve, reject) => {
			socket.once('connect', resolve);
			socket.once('error', reject);
		});
		const managed = new ManagedTestSocket(socket);
		onSocket?.(managed);
		return {
			getSocket: () => managed,
			readEntireBuffer: () => VSBuffer.alloc(0),
			dispose: () => { },
		};
	};
}

async function proxyRequest(
	info: ITunnelProxyInfo,
	options: { method?: string; path: string; auth?: boolean; headers?: Record<string, string> },
): Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: string }> {
	const https = await import('https');
	return new Promise((resolve, reject) => {
		const authHeader = options.auth
			? 'Basic ' + Buffer.from(`${info.credentials.username}:${info.credentials.password}`).toString('base64')
			: undefined;

		const req = https.request({
			hostname: '127.0.0.1',
			port: info.port,
			method: options.method ?? 'GET',
			path: options.path,
			headers: {
				...options.headers,
				...(authHeader ? { 'Proxy-Authorization': authHeader } : {}),
			},
			rejectUnauthorized: false,
		}, res => {
			const chunks: Buffer[] = [];
			res.on('data', c => chunks.push(c));
			res.on('end', () => resolve({
				statusCode: res.statusCode!,
				headers: res.headers,
				body: Buffer.concat(chunks).toString(),
			}));
		});
		req.on('error', reject);
		req.end();
	});
}

async function proxyConnect(
	info: ITunnelProxyInfo,
	target: string,
	auth: boolean,
): Promise<{ statusCode: number; socket: TLSSocket }> {
	const tls = await import('tls');
	return new Promise((resolve, reject) => {
		const socket = tls.connect({
			host: '127.0.0.1',
			port: info.port,
			rejectUnauthorized: false,
		}, () => {
			const authHeader = auth
				? 'Basic ' + Buffer.from(`${info.credentials.username}:${info.credentials.password}`).toString('base64')
				: undefined;

			let request = `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n`;
			if (authHeader) {
				request += `Proxy-Authorization: ${authHeader}\r\n`;
			}
			request += '\r\n';
			socket.write(request);

			let data = '';
			const onData = (chunk: Buffer) => {
				data += chunk.toString();
				const headerEnd = data.indexOf('\r\n\r\n');
				if (headerEnd !== -1) {
					socket.removeListener('data', onData);
					const statusLine = data.substring(0, data.indexOf('\r\n'));
					const statusCode = parseInt(statusLine.split(' ')[1], 10);
					resolve({ statusCode, socket });
				}
			};
			socket.on('data', onData);
		});
		socket.on('error', reject);
	});
}


suite('TunnelProxy', () => {

	const ds = ensureNoDisposablesAreLeakedInTestSuite();

	let targetServer: Server;
	let targetPort: number;

	suiteSetup(async () => {
		const http = await import('http');
		targetServer = http.createServer((req, res) => {
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end(`ECHO ${req.method} ${req.url}`);
		});
		targetServer.listen(0, '127.0.0.1');
		await new Promise<void>(resolve => targetServer.once('listening', resolve));
		targetPort = (targetServer.address() as AddressInfo).port;
	});

	suiteTeardown(() => {
		targetServer.close();
	});

	let proxy: TunnelProxy;
	let proxyInfo: ITunnelProxyInfo;

	setup(async () => {
		const connectFn = createMockConnectFn(targetPort);
		proxy = ds.add(new TunnelProxy(connectFn, new NullLogService()));
		proxyInfo = await proxy.start();
	});

	teardown(() => {
		proxy.dispose();
	});


	test('start returns a valid ITunnelProxyInfo', () => {
		assert.strictEqual(proxyInfo.host, '127.0.0.1');
		assert.strictEqual(typeof proxyInfo.port, 'number');
		assert.ok(proxyInfo.port > 0 && proxyInfo.port < 65536);
		assert.strictEqual(proxyInfo.url, `https://127.0.0.1:${proxyInfo.port}`);
		assert.ok(proxyInfo.credentials.username.length > 0);
		assert.ok(proxyInfo.credentials.password.length > 0);
		assert.ok(proxyInfo.certFingerprint.startsWith('sha256/'));
	});


	test('server uses TLS', async () => {
		const tls = await import('tls');
		const socket = await new Promise<TLSSocket>((resolve, reject) => {
			const s = tls.connect({
				host: '127.0.0.1',
				port: proxyInfo.port,
				rejectUnauthorized: false,
			}, () => resolve(s));
			s.on('error', reject);
		});
		assert.ok(socket.encrypted);
		const cert = socket.getPeerCertificate();
		assert.strictEqual(cert.subject?.CN, 'TunnelProxy');
		socket.end();
	});


	test('rejects plain HTTP request without credentials (407)', async () => {
		const res = await proxyRequest(proxyInfo, {
			path: `http://127.0.0.1:${targetPort}/hello`,
			auth: false,
		});
		assert.strictEqual(res.statusCode, 407);
	});

	test('rejects CONNECT without credentials (407)', async () => {
		const { statusCode, socket } = await proxyConnect(
			proxyInfo,
			`127.0.0.1:${targetPort}`,
			false,
		);
		assert.strictEqual(statusCode, 407);
		socket.end();
	});


	test('forwards authenticated HTTP GET to target', async () => {
		const res = await proxyRequest(proxyInfo, {
			path: `http://127.0.0.1:${targetPort}/some/path`,
			auth: true,
		});
		assert.strictEqual(res.statusCode, 200);
		assert.strictEqual(res.body, `ECHO GET /some/path`);
	});

	test('forwards authenticated HTTP POST to target', async () => {
		const res = await proxyRequest(proxyInfo, {
			method: 'POST',
			path: `http://127.0.0.1:${targetPort}/post`,
			auth: true,
		});
		assert.strictEqual(res.statusCode, 200);
		assert.strictEqual(res.body, 'ECHO POST /post');
	});

	test('strips hop-by-hop headers from forwarded request', async () => {
		const http = await import('http');
		const headerServer = http.createServer((req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(req.headers));
		});
		headerServer.listen(0, '127.0.0.1');
		await new Promise<void>(resolve => headerServer.once('listening', resolve));
		const headerPort = (headerServer.address() as AddressInfo).port;

		try {
			const connectFn = createMockConnectFn(headerPort);
			const proxy2 = ds.add(new TunnelProxy(connectFn, new NullLogService()));
			const info2 = await proxy2.start();

			const res = await proxyRequest(info2, {
				path: `http://127.0.0.1:${headerPort}/`,
				auth: true,
				headers: {
					'Connection': 'keep-alive, X-Custom-Hop',
					'Keep-Alive': 'timeout=5',
					'Proxy-Connection': 'keep-alive',
					'TE': 'trailers',
					'Upgrade': 'websocket',
					'X-Custom-Hop': 'should-be-removed',
					'X-End-To-End': 'should-survive',
				},
			});
			assert.strictEqual(res.statusCode, 200);
			const forwarded = JSON.parse(res.body);
			assert.strictEqual(forwarded['proxy-authorization'], undefined);
			assert.strictEqual(forwarded['proxy-connection'], undefined);
			assert.strictEqual(forwarded['keep-alive'], undefined);
			assert.strictEqual(forwarded['te'], undefined);
			assert.strictEqual(forwarded['upgrade'], undefined);
			assert.strictEqual(forwarded['x-custom-hop'], undefined);
			assert.strictEqual(forwarded['x-end-to-end'], 'should-survive');
			proxy2.dispose();
		} finally {
			headerServer.close();
		}
	});

	test('returns 400 for malformed URL', async () => {
		const res = await proxyRequest(proxyInfo, {
			path: 'not-a-valid-url',
			auth: true,
		});
		assert.strictEqual(res.statusCode, 400);
	});


	test('reuses tunnel socket for multiple requests to the same host', async () => {
		const net = await import('net');
		let connectCount = 0;
		const countingConnect: ITunnelConnectFn = async (_host, _port) => {
			connectCount++;
			const socket = net.createConnection({ host: '127.0.0.1', port: targetPort });
			await new Promise<void>((resolve, reject) => {
				socket.once('connect', resolve);
				socket.once('error', reject);
			});
			return mockTunnelProtocol(socket);
		};
		const poolProxy = ds.add(new TunnelProxy(countingConnect, new NullLogService()));
		const poolInfo = await poolProxy.start();

		for (let i = 0; i < 3; i++) {
			const res = await proxyRequest(poolInfo, {
				path: `http://127.0.0.1:${targetPort}/req${i}`,
				auth: true,
			});
			assert.strictEqual(res.statusCode, 200);
			assert.strictEqual(res.body, `ECHO GET /req${i}`);
		}

		assert.strictEqual(connectCount, 1, `Expected 1 tunnel connection, got ${connectCount}`);
		poolProxy.dispose();
	});

	test('drainConnectionPool destroys pooled tunnel sockets', async () => {
		const net = await import('net');

		const remoteSockets: import('net').Socket[] = [];
		const connectFn: ITunnelConnectFn = async () => {
			const socket = net.createConnection({ host: '127.0.0.1', port: targetPort });
			await new Promise<void>((resolve, reject) => {
				socket.once('connect', resolve);
				socket.once('error', reject);
			});
			remoteSockets.push(socket);
			return mockTunnelProtocol(socket);
		};
		const p = ds.add(new TunnelProxy(connectFn, new NullLogService()));
		const info = await p.start();

		const res = await proxyRequest(info, { path: `http://127.0.0.1:${targetPort}/`, auth: true });
		assert.strictEqual(res.statusCode, 200);
		assert.strictEqual(remoteSockets.length, 1);
		assert.strictEqual(remoteSockets[0].destroyed, false);

		const closed = new Promise<void>(resolve => remoteSockets[0].once('close', () => resolve()));
		p.drainConnectionPool();
		await closed;
		assert.strictEqual(remoteSockets[0].destroyed, true);

		p.dispose();
	});

	test('a reset on a pooled tunnel socket does not escalate to an uncaught exception', async () => {
		const net = await import('net');

		const remoteSockets: import('net').Socket[] = [];
		const connectFn: ITunnelConnectFn = async () => {
			const socket = net.createConnection({ host: '127.0.0.1', port: targetPort });
			await new Promise<void>((resolve, reject) => {
				socket.once('connect', resolve);
				socket.once('error', reject);
			});
			remoteSockets.push(socket);
			return mockTunnelProtocol(socket);
		};
		const p = ds.add(new TunnelProxy(connectFn, new NullLogService()));
		const info = await p.start();

		const res = await proxyRequest(info, { path: `http://127.0.0.1:${targetPort}/`, auth: true });
		assert.strictEqual(res.statusCode, 200);
		assert.strictEqual(remoteSockets.length, 1);

		assert.doesNotThrow(() => remoteSockets[0].emit('error', new Error('simulated upstream reset')));

		p.dispose();
	});


	test('CONNECT establishes a tunnel to the target', async () => {
		const { statusCode, socket } = await proxyConnect(
			proxyInfo,
			`127.0.0.1:${targetPort}`,
			true,
		);
		assert.strictEqual(statusCode, 200);

		socket.write(`GET /tunneled HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\nConnection: close\r\n\r\n`);
		const body = await new Promise<string>((resolve, reject) => {
			const chunks: Buffer[] = [];
			socket.on('data', c => chunks.push(c));
			socket.on('end', () => resolve(Buffer.concat(chunks).toString()));
			socket.on('error', reject);
		});
		assert.ok(body.includes('ECHO GET /tunneled'), `Expected tunneled echo, got: ${body}`);
	});

	test('CONNECT rejects invalid port 0', async () => {
		const { statusCode, socket } = await proxyConnect(proxyInfo, '127.0.0.1:0', true);
		assert.strictEqual(statusCode, 400);
		socket.end();
	});

	test('CONNECT rejects port > 65535', async () => {
		const { statusCode, socket } = await proxyConnect(proxyInfo, '127.0.0.1:99999', true);
		assert.strictEqual(statusCode, 400);
		socket.end();
	});


	test('fails the request when the tunnel connection fails', async () => {
		const failingConnect: ITunnelConnectFn = async () => {
			throw new Error('connect ECONNREFUSED 127.0.0.1:9999');
		};
		const failProxy = ds.add(new TunnelProxy(failingConnect, new NullLogService()));
		const failInfo = await failProxy.start();

		await assert.rejects(() => proxyRequest(failInfo, {
			path: 'http://unreachable.example.com/path',
			auth: true,
		}));

		const { statusCode, socket } = await proxyConnect(failInfo, 'unreachable.example.com:443', true);
		assert.strictEqual(statusCode, 502);
		socket.end();

		failProxy.dispose();
	});


	test('dispose shuts down the server', async () => {
		const connectFn = createMockConnectFn(targetPort);
		const p = ds.add(new TunnelProxy(connectFn, new NullLogService()));
		const info = await p.start();
		p.dispose();

		await assert.rejects(
			() => proxyRequest(info, { path: `http://127.0.0.1:${targetPort}/`, auth: true }),
			/ECONNREFUSED/,
		);
	});

	test('dispose terminates active CONNECT tunnels', async () => {
		const connectFn = createMockConnectFn(targetPort);
		const p = ds.add(new TunnelProxy(connectFn, new NullLogService()));
		const info = await p.start();

		const { statusCode, socket } = await proxyConnect(info, `127.0.0.1:${targetPort}`, true);
		assert.strictEqual(statusCode, 200);

		const closed = new Promise<void>(resolve => socket.once('close', () => resolve()));

		p.dispose();

		await closed;
	});

	test('dispose synchronously destroys the remote tunnel socket', async () => {
		const net = await import('net');

		const remoteSockets: import('net').Socket[] = [];
		const connectFn: ITunnelConnectFn = async () => {
			const socket = net.createConnection({ host: '127.0.0.1', port: targetPort });
			await new Promise<void>((resolve, reject) => {
				socket.once('connect', resolve);
				socket.once('error', reject);
			});
			remoteSockets.push(socket);
			return mockTunnelProtocol(socket);
		};
		const p = ds.add(new TunnelProxy(connectFn, new NullLogService()));
		const info = await p.start();

		const { statusCode, socket } = await proxyConnect(info, `127.0.0.1:${targetPort}`, true);
		assert.strictEqual(statusCode, 200);
		assert.strictEqual(remoteSockets.length, 1);

		p.dispose();

		assert.strictEqual(remoteSockets[0].destroyed, true);
		socket.end();
	});

	test('dispose terminates CONNECT sockets stuck waiting for the upstream tunnel', async () => {
		const tls = await import('tls');

		let connectCalled: () => void;
		const connectCalledPromise = new Promise<void>(resolve => { connectCalled = resolve; });
		const hangingConnect: ITunnelConnectFn = () => {
			connectCalled();
			return new Promise(() => { });
		};
		const p = ds.add(new TunnelProxy(hangingConnect, new NullLogService()));
		const info = await p.start();

		const clientSocket = await new Promise<TLSSocket>((resolve, reject) => {
			const s = tls.connect({
				host: '127.0.0.1',
				port: info.port,
				rejectUnauthorized: false,
			}, () => {
				const authHeader = 'Basic ' + Buffer.from(`${info.credentials.username}:${info.credentials.password}`).toString('base64');
				s.write(`CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\nProxy-Authorization: ${authHeader}\r\n\r\n`);
				resolve(s);
			});
			s.on('error', reject);
		});

		await connectCalledPromise;

		const closed = new Promise<void>(resolve => clientSocket.once('close', () => resolve()));
		p.dispose();
		await closed;
	});

	test('dispose terminates idle HTTPS keep-alive connections', async () => {
		const https = await import('https');
		const connectFn = createMockConnectFn(targetPort);
		const p = ds.add(new TunnelProxy(connectFn, new NullLogService()));
		const info = await p.start();

		const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });
		const responseSocket = await new Promise<TLSSocket>((resolve, reject) => {
			let socket: TLSSocket | undefined;
			const req = https.request({
				agent,
				hostname: '127.0.0.1',
				port: info.port,
				method: 'GET',
				path: `http://127.0.0.1:${targetPort}/keepalive`,
				headers: {
					'Proxy-Authorization': 'Basic ' + Buffer.from(`${info.credentials.username}:${info.credentials.password}`).toString('base64'),
				},
			}, res => {
				res.on('data', () => { });
				res.on('end', () => resolve(socket!));
			});
			req.on('socket', s => { socket = s as TLSSocket; });
			req.on('error', reject);
			req.end();
		});

		const closed = new Promise<void>(resolve => responseSocket.once('close', () => resolve()));

		p.dispose();
		agent.destroy();

		await closed;
	});

	suite('managed (non-NodeSocket) transport', () => {

		let managedProxy: TunnelProxy;
		let managedInfo: ITunnelProxyInfo;

		setup(async () => {
			managedProxy = ds.add(new TunnelProxy(createManagedConnectFn(targetPort), new NullLogService()));
			managedInfo = await managedProxy.start();
		});

		teardown(() => {
			managedProxy.dispose();
		});

		test('forwards an authenticated HTTP GET through a managed socket', async () => {
			const res = await proxyRequest(managedInfo, {
				path: `http://127.0.0.1:${targetPort}/managed/path`,
				auth: true,
			});
			assert.strictEqual(res.statusCode, 200);
			assert.strictEqual(res.body, 'ECHO GET /managed/path');
		});

		test('CONNECT tunnels bidirectional data through a managed socket', async () => {
			const { statusCode, socket } = await proxyConnect(managedInfo, `127.0.0.1:${targetPort}`, true);
			assert.strictEqual(statusCode, 200);

			socket.write(`GET /managed-tunnel HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\nConnection: close\r\n\r\n`);
			const body = await new Promise<string>((resolve, reject) => {
				const chunks: Buffer[] = [];
				socket.on('data', c => chunks.push(c));
				socket.on('end', () => resolve(Buffer.concat(chunks).toString()));
				socket.on('error', reject);
			});
			assert.ok(body.includes('ECHO GET /managed-tunnel'), `Expected tunneled echo, got: ${body}`);
		});

		test('dispose disposes the managed remote socket via the adapter', async () => {
			let captured: ManagedTestSocket | undefined;
			const p = ds.add(new TunnelProxy(createManagedConnectFn(targetPort, s => { captured = s; }), new NullLogService()));
			const info = await p.start();

			const { statusCode, socket } = await proxyConnect(info, `127.0.0.1:${targetPort}`, true);
			assert.strictEqual(statusCode, 200);
			assert.ok(captured);

			p.dispose();

			assert.strictEqual(captured.isDisposed, true);
			socket.end();
		});
	});
});

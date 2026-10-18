/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@ts-check
/// <reference lib="webworker" />


const sw = /** @type {any} */ (self);

const VERSION = 6;

const maxActiveHostResourceResponseBodies = 32;

const resourceCacheName = `vscode-resource-cache-${VERSION}`;

const rootPath = sw.location.pathname.replace(/\/service-worker.js$/, '');

const searchParams = new URL(location.toString()).searchParams;

const remoteAuthority = searchParams.get('remoteAuthority');
const shouldLimitHostResourceResponseBodies = searchParams.get('platform') === 'electron';




const resourceBaseAuthority = searchParams.get('vscode-resource-base-authority');





const perfMark = (name, options = {}) => {
	performance.mark(`webview/service-worker/${name}`, {
		detail: {
			...options
		}
	});
};

perfMark('scriptStart');


const resolveTimeout = 30_000;

















class RequestStore {
	constructor() {

		this.map = new Map();

		this.requestPool = 0;
	}




	create() {
		const requestId = ++this.requestPool;


		let resolve;
		const promise = new Promise(r => resolve = r);


		const entry = { resolve, promise };
		this.map.set(requestId, entry);

		const dispose = () => {
			clearTimeout(timeout);
			const existingEntry = this.map.get(requestId);
			if (existingEntry === entry) {
				existingEntry.resolve({ status: 'timeout' });
				this.map.delete(requestId);
			}
		};
		const timeout = setTimeout(dispose, resolveTimeout);
		return { requestId, promise };
	}






	resolve(requestId, result) {
		const entry = this.map.get(requestId);
		if (!entry) {
			return false;
		}
		entry.resolve({ status: 'ok', value: result });
		this.map.delete(requestId);
		return true;
	}
}

class AsyncSemaphore {



	constructor(maxConcurrency) {
		this.maxConcurrency = maxConcurrency;
		this.activeCount = 0;

		this.waiters = [];
	}




	acquire() {
		if (this.activeCount < this.maxConcurrency && this.waiters.length === 0) {
			this.activeCount++;
			return Promise.resolve(this.createReleaser());
		}

		return new Promise(resolve => this.waiters.push(resolve));
	}




	createReleaser() {
		let released = false;
		return () => {
			if (released) {
				return;
			}
			released = true;

			const waiter = this.waiters.shift();
			if (waiter) {
				waiter(this.createReleaser());
			} else {
				this.activeCount--;
			}
		};
	}
}






function createJoinedFinalizer(release, pendingCount) {
	let remaining = pendingCount;
	let finished = false;
	return () => {
		if (finished) {
			return;
		}

		remaining--;
		if (remaining === 0) {
			finished = true;
			release();
		}
	};
}






function trackReadableStreamLifetime(stream, onDidFinish) {
	const reader = stream.getReader();
	let finished = false;
	const finish = () => {
		if (finished) {
			return;
		}
		finished = true;
		onDidFinish();
	};

	return new ReadableStream({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					finish();
					controller.close();
					return;
				}

				controller.enqueue(value);
			} catch (error) {
				finish();
				throw error;
			}
		},
		cancel(reason) {
			const cancellation = reader.cancel(reason).catch(() => undefined);
			if (shouldLimitHostResourceResponseBodies) {
				return cancellation.finally(finish);
			}
			finish();
			return cancellation;
		}
	});
}





const resourceRequestStore = new RequestStore();

const hostResourceResponseBodySemaphore = new AsyncSemaphore(maxActiveHostResourceResponseBodies);






const safariResourceStreams = new Map();





const localhostRequestStore = new RequestStore();

const unauthorized = () =>
	new Response('Unauthorized', { status: 401, });

const notFound = () =>
	new Response('Not Found', { status: 404, });

const methodNotAllowed = () =>
	new Response('Method Not Allowed', { status: 405, });

const requestTimeout = () =>
	new Response('Request Timeout', { status: 408, });

sw.addEventListener('message', async (event) => {
	if (!event.source) {
		return;
	}


	const source = event.source;
	switch (event.data.channel) {
		case 'did-load-resource': {

			const response = event.data.data;
			if (response.status === 200 || response.status === 206) {

				let stream;
				if (response.stream) {
					stream = response.stream;
				} else {
					const transform = new TransformStream();
					const writer = transform.writable.getWriter();
					safariResourceStreams.set(response.id, writer);
					writer.closed.then(
						() => safariResourceStreams.delete(response.id),
						() => safariResourceStreams.delete(response.id)
					);
					stream = transform.readable;
				}
				if (response.stream) {
					if (!resourceRequestStore.resolve(response.id, {
						status: response.status,
						id: response.id,
						path: response.path,
						mime: response.mime,
						etag: response.etag,
						mtime: response.mtime,
						stream,
						range: response.range,
					})) {
						event.waitUntil(stream.cancel().catch(() => undefined));
					}
				} else {
					resourceRequestStore.resolve(response.id, {
						status: response.status,
						id: response.id,
						path: response.path,
						mime: response.mime,
						etag: response.etag,
						mtime: response.mtime,
						stream,
						range: response.range,
					});
				}
			} else if (!resourceRequestStore.resolve(response.id, response)) {
				console.log('Could not resolve unknown resource', response.path);
			}
			return;
		}
		case 'did-load-resource-chunk': {
			const data = event.data.data;
			const writer = safariResourceStreams.get(data.id);
			if (writer) {
				writer.write(data.data).catch(() => {
					safariResourceStreams.delete(data.id);
				});
			}
			return;
		}
		case 'did-load-resource-end': {
			const data = event.data.data;
			const writer = safariResourceStreams.get(data.id);
			if (writer) {
				if (data.error) {
					writer.abort(new Error('Stream error')).catch(() => { });
				} else {
					writer.close().catch(() => { });
				}
				safariResourceStreams.delete(data.id);
			}
			return;
		}
		case 'did-load-localhost': {
			const data = event.data.data;
			if (!localhostRequestStore.resolve(data.id, data.location)) {
				console.log('Could not resolve unknown localhost', data.origin);
			}
			return;
		}
		default: {
			console.log('Unknown message');
			return;
		}
	}
});

sw.addEventListener('fetch', (event) => {
	const requestUrl = new URL(event.request.url);
	if (typeof resourceBaseAuthority === 'string' && requestUrl.protocol === 'https:' && requestUrl.hostname.endsWith('.' + resourceBaseAuthority)) {
		switch (event.request.method) {
			case 'GET':
			case 'HEAD': {
				const firstHostSegment = requestUrl.hostname.slice(0, requestUrl.hostname.length - (resourceBaseAuthority.length + 1));
				const scheme = firstHostSegment.split('+', 1)[0];
				const authority = firstHostSegment.slice(scheme.length + 1);
				return event.respondWith(processResourceRequest(event, {
					scheme,
					authority,
					path: requestUrl.pathname,
					query: requestUrl.search.replace(/^\?/, ''),
				}));
			}
			default: {
				return event.respondWith(methodNotAllowed());
			}
		}
	}

	if (requestUrl.origin !== sw.origin && requestUrl.host === remoteAuthority) {
		switch (event.request.method) {
			case 'GET':
			case 'HEAD': {
				return event.respondWith(processResourceRequest(event, {
					path: requestUrl.pathname,
					scheme: requestUrl.protocol.slice(0, requestUrl.protocol.length - 1),
					authority: requestUrl.host,
					query: requestUrl.search.replace(/^\?/, ''),
				}));
			}
			default: {
				return event.respondWith(methodNotAllowed());
			}
		}
	}

	if (requestUrl.origin !== sw.origin && requestUrl.host.match(/^(localhost|127.0.0.1|0.0.0.0):(\d+)$/)) {
		return event.respondWith(processLocalhostRequest(event, requestUrl));
	}
});

sw.addEventListener('install', (event) => {
	event.waitUntil(sw.skipWaiting());
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(sw.clients.claim());
});















async function processResourceRequest(
	event,
	requestUrlComponents
) {
	let client = await sw.clients.get(event.clientId);
	if (!client) {
		client = await getWorkerClientForId(event.clientId);
		if (!client) {
			console.error('Could not find inner client for request');
			return notFound();
		}
	}

	const webviewId = getWebviewIdForClient(client);

	if (!webviewId && client.type !== 'worker' && client.type !== 'sharedworker') {
		console.error('Could not resolve webview id');
		return notFound();
	}

	const shouldTryCaching = (event.request.method === 'GET' && !event.request.headers.get('range'));






	const resolveResourceEntry = (result, cachedResponse, releaseHostResourceResponseBody) => {
		if (result.status === 'timeout') {
			releaseHostResourceResponseBody();
			return requestTimeout();
		}


		const accessControlHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Cross-Origin-Resource-Policy': 'cross-origin',
		};

		const entry = result.value;
		if (entry.status === 304) {
			if (cachedResponse) {
				releaseHostResourceResponseBody();
				const r = cachedResponse.clone();
				for (const [key, value] of Object.entries(accessControlHeaders)) {
					r.headers.set(key, value);
				}
				return r;
			} else {
				throw new Error('No cache found');
			}
		}

		if (entry.status === 401) {
			releaseHostResourceResponseBody();
			return unauthorized();
		}

		if (entry.status !== 200 && entry.status !== 206) {
			releaseHostResourceResponseBody();
			return notFound();
		}


		const headers = {
			...accessControlHeaders,
			'Content-Type': entry.mime,
		};

		if (entry.etag) {
			headers['ETag'] = entry.etag;
			headers['Cache-Control'] = 'no-cache';
		}
		if (entry.mtime) {
			headers['Last-Modified'] = new Date(entry.mtime).toUTCString();
		}

		const coiRequest = new URL(event.request.url).searchParams.get('vscode-coi');
		if (coiRequest === '3') {
			headers['Cross-Origin-Opener-Policy'] = 'same-origin';
			headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
		} else if (coiRequest === '2') {
			headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
		} else if (coiRequest === '1') {
			headers['Cross-Origin-Opener-Policy'] = 'same-origin';
		}

		if (entry.stream) {
			if (entry.status === 206 && entry.range) {
				headers['Content-Range'] = entry.range;
				headers['Cache-Control'] = 'no-store';
				return new Response(trackReadableStreamLifetime(entry.stream, releaseHostResourceResponseBody), { status: 206, headers });
			}

			if (shouldTryCaching && entry.etag) {
				const [responseStream, cacheStream] = entry.stream.tee();
				const releaseAfterResponseAndCache = createJoinedFinalizer(releaseHostResourceResponseBody, 2);
				const response = new Response(trackReadableStreamLifetime(responseStream, releaseAfterResponseAndCache), { status: 200, headers });
				const responseForCache = new Response(cacheStream, { status: 200, headers });
				void caches.open(resourceCacheName)
					.then(cache => cache.put(event.request, responseForCache))
					.then(undefined, () => undefined)
					.finally(releaseAfterResponseAndCache);
				return response;
			}

			return new Response(trackReadableStreamLifetime(entry.stream, releaseHostResourceResponseBody), { status: 200, headers });
		}
	};


	let cached;
	if (shouldTryCaching) {
		const cache = await caches.open(resourceCacheName);
		cached = await cache.match(event.request);
	}


	let range;
	const rangeHeader = event.request.headers.get('range');
	if (rangeHeader) {
		const bytes = rangeHeader.match(/^bytes\=(\d+)\-(\d+)?$/);
		if (bytes) {
			range = {
				start: Number(bytes[1]),
				end: bytes[2] !== undefined ? Number(bytes[2]) : undefined,
			};
		} else {
			return new Response(null, {
				status: 416,
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Content-Range': '*/*',
				}
			});
		}
	}


	let parentClients;
	if (webviewId) {
		parentClients = await getOuterIframeClient(webviewId);
		if (!parentClients.length) {
			console.log('Could not find parent client for request');
			return notFound();
		}
	}

	const releaseHostResourceResponseBody = shouldLimitHostResourceResponseBodies && webviewId
		? await hostResourceResponseBodySemaphore.acquire()
		: () => { };

	const { requestId, promise } = resourceRequestStore.create();
	try {
		if (parentClients) {
			for (const parentClient of parentClients) {
				parentClient.postMessage({
					channel: 'load-resource',
					id: requestId,
					scheme: requestUrlComponents.scheme,
					authority: requestUrlComponents.authority,
					path: requestUrlComponents.path,
					query: requestUrlComponents.query,
					ifNoneMatch: cached?.headers.get('ETag'),
					range,
				});
			}
		}

		const entry = await promise;
		try {
			return resolveResourceEntry(entry, cached, releaseHostResourceResponseBody);
		} catch (error) {
			releaseHostResourceResponseBody();
			throw error;
		}
	} catch (error) {
		releaseHostResourceResponseBody();
		throw error;
	}
}






async function processLocalhostRequest(
	event,
	requestUrl
) {
	const client = await sw.clients.get(event.clientId);
	if (!client) {
		return fetch(event.request);
	}
	const webviewId = getWebviewIdForClient(client);
	if (!webviewId && client.type !== 'worker' && client.type !== 'sharedworker') {
		console.error('Could not resolve webview id');
		return fetch(event.request);
	}

	const origin = requestUrl.origin;





	const resolveRedirect = async function (result) {
		if (result.status !== 'ok' || !result.value) {
			return fetch(event.request);
		}

		const redirectOrigin = result.value;
		const location = event.request.url.replace(new RegExp(`^${requestUrl.origin}(/|$)`), `${redirectOrigin}$1`);
		return new Response(null, {
			status: 302,
			headers: {
				Location: location
			}
		});
	};

	const { requestId, promise } = localhostRequestStore.create();
	if (webviewId) {
		const parentClients = await getOuterIframeClient(webviewId);
		if (!parentClients.length) {
			console.log('Could not find parent client for request');
			return notFound();
		}
		for (const parentClient of parentClients) {
			parentClient.postMessage({
				channel: 'load-localhost',
				origin: origin,
				id: requestId,
			});
		}
	}

	return promise.then(resolveRedirect);
}





function getWebviewIdForClient(client) {
	const requesterClientUrl = new URL(client.url);
	return requesterClientUrl.searchParams.get('id');
}





async function getOuterIframeClient(webviewId) {
	const allClients = await sw.clients.matchAll({ includeUncontrolled: true });
	return allClients.filter(client => {
		const clientUrl = new URL(client.url);
		const hasExpectedPathName = (clientUrl.pathname === `${rootPath}/` || clientUrl.pathname === `${rootPath}/index.html` || clientUrl.pathname === `${rootPath}/index-no-csp.html`);
		return hasExpectedPathName && clientUrl.searchParams.get('id') === webviewId;
	});
}





async function getWorkerClientForId(clientId) {
	const allDedicatedWorkerClients = await sw.clients.matchAll({ type: 'worker' });
	const allSharedWorkerClients = await sw.clients.matchAll({ type: 'sharedworker' });
	const allWorkerClients = [...allDedicatedWorkerClients, ...allSharedWorkerClients];
	return allWorkerClients.find(client => {
		return client.id === clientId;
	});
}

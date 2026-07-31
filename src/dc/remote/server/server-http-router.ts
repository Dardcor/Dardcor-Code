import type { IncomingMessage, ServerResponse } from 'node:http';

export type RouteHandler = (request: IncomingMessage, response: ServerResponse, params: Record<string, string>) => void | Promise<void>;

export interface IHttpRoute {
	readonly method: string;
	readonly pattern: string;
	readonly segments: string[];
	readonly handler: RouteHandler;
}

export interface IUrlParts {
	readonly pathname: string;
	readonly query: URLSearchParams;
	readonly search: string;
	readonly path: string;
}

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;

export function parseUrl(url: string, base = 'http://localhost'): IUrlParts {
	const parsed = new URL(url, base);
	return {
		pathname: parsed.pathname,
		query: parsed.searchParams,
		search: parsed.search,
		path: `${parsed.pathname}${parsed.search}`
	};
}

export function matchRouteSegments(segments: string[], urlPathname: string): { matches: boolean; params: Record<string, string> } {
	const parts = urlPathname.split('/').filter(Boolean);
	if (parts.length !== segments.length) {
		return { matches: false, params: {} };
	}
	const params: Record<string, string> = {};
	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];
		if (segment.startsWith(':')) {
			params[segment.slice(1)] = decodeURIComponent(parts[i] ?? '');
			continue;
		}
		if (segment === '*') {
			params[segment] = parts[i] ?? '';
			continue;
		}
		if (segment !== parts[i]) {
			return { matches: false, params: {} };
		}
	}
	return { matches: true, params };
}

export class ServerHttpRouter {
	private readonly _routes: IHttpRoute[] = [];
	private _notFoundHandler: RouteHandler | null = null;

	register(method: string, path: string, handler: RouteHandler): IHttpRoute {
		const normalizedMethod = method.toUpperCase();
		const segments = path.split('/').filter(Boolean);
		const route: IHttpRoute = { method: normalizedMethod, pattern: path, segments, handler };
		this._routes.push(route);
		return route;
	}

	addRoute(method: string, path: string, handler: RouteHandler): IHttpRoute {
		return this.register(method, path, handler);
	}

	get(path: string, handler: RouteHandler): IHttpRoute {
		return this.register('GET', path, handler);
	}

	post(path: string, handler: RouteHandler): IHttpRoute {
		return this.register('POST', path, handler);
	}

	put(path: string, handler: RouteHandler): IHttpRoute {
		return this.register('PUT', path, handler);
	}

	patch(path: string, handler: RouteHandler): IHttpRoute {
		return this.register('PATCH', path, handler);
	}

	delete(path: string, handler: RouteHandler): IHttpRoute {
		return this.register('DELETE', path, handler);
	}

	options(path: string, handler: RouteHandler): IHttpRoute {
		return this.register('OPTIONS', path, handler);
	}

	setNotFoundHandler(handler: RouteHandler): void {
		this._notFoundHandler = handler;
	}

	async route(request: IncomingMessage, response: ServerResponse, url: string, method?: string): Promise<boolean> {
		const requestMethod = (method ?? request.method ?? 'GET').toUpperCase();
		const urlParts = parseUrl(url);
		const candidates = this._routes.filter(route => route.method === requestMethod);
		if (candidates.length === 0) {
			return this._handleMethodNotAllowed(response, requestMethod);
		}
		for (const route of candidates) {
			const match = matchRouteSegments(route.segments, urlParts.pathname);
			if (!match.matches) {
				continue;
			}
			try {
				await route.handler(request, response, match.params);
			} catch (error) {
				this.sendError(response, error instanceof Error ? error.message : String(error), 500);
			}
			return true;
		}
		return this._handleNotFound(request, response, urlParts.pathname);
	}

	handleNotFound(request: IncomingMessage, response: ServerResponse): void {
		if (this._notFoundHandler) {
			void this._notFoundHandler(request, response, {});
			return;
		}
		this.sendText(response, `404 Not Found: ${request.url}`, 404);
	}

	match(method: string, url: string): { route: IHttpRoute | null; params: Record<string, string> } {
		const urlParts = parseUrl(url);
		for (const route of this._routes) {
			if (route.method !== method.toUpperCase()) {
				continue;
			}
			const match = matchRouteSegments(route.segments, urlParts.pathname);
			if (match.matches) {
				return { route, params: match.params };
			}
		}
		return { route: null, params: {} };
	}

	listRoutes(): IHttpRoute[] {
		return [...this._routes];
	}

	sendJson(response: ServerResponse, data: unknown, status = 200): void {
		this._send(response, status, 'application/json', JSON.stringify(data));
	}

	sendText(response: ServerResponse, text: string, status = 200): void {
		this._send(response, status, 'text/plain', text);
	}

	sendHtml(response: ServerResponse, html: string, status = 200): void {
		this._send(response, status, 'text/html', html);
	}

	sendError(response: ServerResponse, message: string, status = 400): void {
		this.sendJson(response, { error: message, status }, status);
	}

	sendRedirect(response: ServerResponse, location: string, status = 302): void {
		if (!response.headersSent) {
			response.writeHead(status, { Location: location });
		}
		response.end();
	}

	removeRoute(pattern: string, method?: string): boolean {
		const before = this._routes.length;
		this._routes.splice(0, this._routes.length, ...this._routes.filter(route =>
			route.pattern !== pattern || (method !== undefined && route.method !== method.toUpperCase())
		));
		return this._routes.length < before;
	}

	clear(): void {
		this._routes.length = 0;
	}

	private _handleNotFound(request: IncomingMessage, response: ServerResponse, pathname: string): boolean {
		this.handleNotFound(request, response);
		void pathname;
		return true;
	}

	private _handleMethodNotAllowed(response: ServerResponse, method: string): boolean {
		this.sendJson(response, { error: `Method ${method} not allowed` }, 405);
		return true;
	}

	private _send(response: ServerResponse, status: number, contentType: string, body: string): void {
		if (response.writableEnded) {
			return;
		}
		response.writeHead(status, { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) });
		response.end(body);
	}
}

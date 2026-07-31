import { Emitter, Event } from '../../core/events/emitter';

export interface IRateLimiterOptions {
	readonly maxRequests?: number;
	readonly windowMs?: number;
	readonly maxRequestsPerRoute?: number;
	readonly enabled?: boolean;
	readonly trustProxy?: boolean;
}

export interface IRateLimitResult {
	readonly allowed: boolean;
	readonly retryAfterMs: number;
	readonly remaining: number;
	readonly windowMs: number;
	readonly limit: number;
}

export interface IRateLimiterStats {
	readonly trackedIps: number;
	readonly totalRequests: number;
	readonly blockedRequests: number;
	readonly currentUsage: number;
	readonly lastResetAt: number;
}

interface IpBucket {
	readonly hits: number[];
	readonly routeHits: Map<string, number[]>;
	blocked: number;
}

export function extractClientIp(request: any): string | null {
	const value = request?.ip
		?? request?.socket?.remoteAddress
		?? request?.connection?.remoteAddress
		?? request?.headers?.['x-forwarded-for']
		?? request?.headers?.['x-real-ip'];
	if (!value) {
		return null;
	}
	if (Array.isArray(value)) {
		return value[0]?.split(',')[0]?.trim() || null;
	}
	const text = String(value);
	return text.split(',')[0].trim() || null;
}

export class RateLimiter {
	private readonly _maxRequests: number;
	private readonly _windowMs: number;
	private readonly _maxRequestsPerRoute: number;
	private readonly _buckets = new Map<string, IpBucket>();

	private _enabled: boolean;
	private _totalRequests = 0;
	private _blockedRequests = 0;
	private _lastResetAt = Date.now();

	private readonly _onBlocked = new Emitter<{ ip: string; route: string | undefined; retryAfterMs: number }>();
	readonly onBlocked: Event<{ ip: string; route: string | undefined; retryAfterMs: number }> = this._onBlocked.event;

	constructor(options: IRateLimiterOptions = {}) {
		this._maxRequests = options.maxRequests ?? 100;
		this._windowMs = options.windowMs ?? 60000;
		this._maxRequestsPerRoute = options.maxRequestsPerRoute ?? Math.floor(this._maxRequests / 2);
		this._enabled = options.enabled ?? true;
	}

	get enabled(): boolean {
		return this._enabled;
	}

	setEnabled(enabled: boolean): void {
		this._enabled = enabled;
	}

	get maxRequests(): number {
		return this._maxRequests;
	}

	get windowMs(): number {
		return this._windowMs;
	}

	hit(ip: string, route?: string): IRateLimitResult {
		this._totalRequests++;
		if (!this._enabled) {
			return { allowed: true, retryAfterMs: 0, remaining: this._maxRequests, windowMs: this._windowMs, limit: this._maxRequests };
		}
		const now = Date.now();
		const bucket = this._getBucket(ip, now);
		this._trim(bucket.hits, now);
		if (route) {
			const routeHits = bucket.routeHits.get(route) ?? [];
			this._trim(routeHits, now);
			bucket.routeHits.set(route, routeHits);
			if (routeHits.length >= this._maxRequestsPerRoute) {
				return this._deny(ip, route, bucket, this._maxRequestsPerRoute);
			}
		}
		if (bucket.hits.length >= this._maxRequests) {
			return this._deny(ip, route, bucket, this._maxRequests);
		}
		bucket.hits.push(now);
		if (route) {
			bucket.routeHits.get(route)!.push(now);
		}
		return {
			allowed: true,
			retryAfterMs: 0,
			remaining: Math.max(0, this._maxRequests - bucket.hits.length),
			windowMs: this._windowMs,
			limit: this._maxRequests
		};
	}

	middleware(request: any, response: any, next: () => void): void {
		if (!this._enabled) {
			next();
			return;
		}
		const ip = extractClientIp(request);
		if (!ip) {
			next();
			return;
		}
		const route = request?.url ? String(request.url).split('?')[0] : undefined;
		const result = this.hit(ip, route);
		if (result.allowed) {
			next();
			return;
		}
		const hasHttpResponse = response && typeof response.setHeader === 'function' && typeof response.writeHead === 'function' && typeof response.end === 'function';
		if (!hasHttpResponse) {
			return;
		}
		try {
			response.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
			response.setHeader('X-RateLimit-Limit', String(result.limit));
			response.setHeader('X-RateLimit-Remaining', '0');
			response.setHeader('X-RateLimit-Reset', String(Math.ceil((Date.now() + result.retryAfterMs) / 1000)));
			response.writeHead(429, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({
				error: 'rate_limited',
				message: 'Too many requests',
				retryAfterMs: result.retryAfterMs
			}));
		} catch {
			next();
		}
	}

	check(ip: string, route?: string): IRateLimitResult {
		const now = Date.now();
		const bucket = this._buckets.get(ip);
		if (!bucket) {
			return { allowed: true, retryAfterMs: 0, remaining: this._maxRequests, windowMs: this._windowMs, limit: this._maxRequests };
		}
		this._trim(bucket.hits, now);
		if (bucket.hits.length >= this._maxRequests) {
			return this._deny(ip, route, bucket, this._maxRequests);
		}
		if (route) {
			const routeHits = bucket.routeHits.get(route) ?? [];
			this._trim(routeHits, now);
			if (routeHits.length >= this._maxRequestsPerRoute) {
				return this._deny(ip, route, bucket, this._maxRequestsPerRoute);
			}
		}
		return {
			allowed: true,
			retryAfterMs: 0,
			remaining: Math.max(0, this._maxRequests - bucket.hits.length),
			windowMs: this._windowMs,
			limit: this._maxRequests
		};
	}

	reset(ip?: string): void {
		if (ip) {
			this._buckets.delete(ip);
		} else {
			this._buckets.clear();
			this._lastResetAt = Date.now();
			this._totalRequests = 0;
			this._blockedRequests = 0;
		}
	}

	prune(maxBuckets = 10000): number {
		if (this._buckets.size <= maxBuckets) {
			return 0;
		}
		const now = Date.now();
		let removed = 0;
		for (const [ip, bucket] of this._buckets) {
			this._trim(bucket.hits, now);
			if (bucket.hits.length === 0) {
				this._buckets.delete(ip);
				removed++;
			}
			if (this._buckets.size <= maxBuckets) {
				break;
			}
		}
		return removed;
	}

	getStats(): IRateLimiterStats {
		let currentUsage = 0;
		const now = Date.now();
		for (const bucket of this._buckets.values()) {
			this._trim(bucket.hits, now);
			currentUsage += bucket.hits.length;
		}
		return {
			trackedIps: this._buckets.size,
			totalRequests: this._totalRequests,
			blockedRequests: this._blockedRequests,
			currentUsage,
			lastResetAt: this._lastResetAt
		};
	}

	private _deny(ip: string, route: string | undefined, bucket: IpBucket, limit: number): IRateLimitResult {
		this._blockedRequests++;
		bucket.blocked++;
		const oldest = bucket.hits[0] ?? Date.now();
		const retryAfterMs = Math.max(1, oldest + this._windowMs - Date.now());
		this._onBlocked.fire({ ip, route, retryAfterMs });
		return { allowed: false, retryAfterMs, remaining: 0, windowMs: this._windowMs, limit };
	}

	private _getBucket(ip: string, now: number): IpBucket {
		let bucket = this._buckets.get(ip);
		if (!bucket) {
			bucket = { hits: [], routeHits: new Map(), blocked: 0 };
			this._buckets.set(ip, bucket);
		}
		this._trim(bucket.hits, now);
		return bucket;
	}

	private _trim(hits: number[], now: number): void {
		const cutoff = now - this._windowMs;
		while (hits.length > 0 && hits[0] <= cutoff) {
			hits.shift();
		}
	}
}


import { CLOUD_CODE_API, LOAD_CODE_ASSIST_HEADERS, ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS, LOAD_CODE_ASSIST_METADATA } from "../config/appConstants.js";

const projectIdCache = new Map();

const CACHE_TTL_MS = 60 * 60 * 1000;

const pendingFetches = new Map();

const PENDING_TTL_MS = 2 * 60 * 1000;

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

let _cleanupTimer = null;

export function cleanupNow() {
    const now = Date.now();

    for (const [id, entry] of projectIdCache) {
        if (!entry || now - entry.fetchedAt >= CACHE_TTL_MS) {
            projectIdCache.delete(id);
        }
    }

    for (const [id, item] of pendingFetches) {
        if (!item || typeof item.startedAt !== "number") {
            pendingFetches.delete(id);
            continue;
        }
        if (now - item.startedAt > PENDING_TTL_MS) {
            try { item.controller.abort(); } catch (_) { }
            pendingFetches.delete(id);
        }
    }
}

export function startCacheCleanup() {
    if (_cleanupTimer) return;
    _cleanupTimer = setInterval(() => {
        try { cleanupNow(); } catch (e) {
            console.warn("[ProjectId] cleanup sweep error:", e?.message ?? e);
        }
    }, CLEANUP_INTERVAL_MS);
    _cleanupTimer?.unref?.();
}

export function stopCacheCleanup() {
    if (!_cleanupTimer) return;
    clearInterval(_cleanupTimer);
    _cleanupTimer = null;
}

startCacheCleanup();


export async function getProjectIdForConnection(connectionId, accessToken, provider = "gemini-cli") {
    if (!connectionId || !accessToken) return null;

    const cached = projectIdCache.get(connectionId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.projectId;
    }

    if (pendingFetches.has(connectionId)) {
        return pendingFetches.get(connectionId).promise;
    }

    const controller = new AbortController();

    const promise = (async () => {
        try {
            const projectId = await fetchProjectId(accessToken, controller.signal, provider);
            if (projectId) {
                projectIdCache.set(connectionId, {projectId, fetchedAt: Date.now()});
                return projectId;
            }
            console.warn("[ProjectId] could not fetch projectId for connection", connectionId.slice(0, 8));
            return null;
        } catch (error) {
            console.warn(`[ProjectId] Error fetching project ID: ${error.message}`);
            return null;
        } finally {
            pendingFetches.delete(connectionId);
        }
    })();

    pendingFetches.set(connectionId, {promise, controller, startedAt: Date.now()});
    return promise;
}

export function invalidateProjectId(connectionId) {
    projectIdCache.delete(connectionId);
}

export function removeConnection(connectionId) {
    if (!connectionId) return;
    projectIdCache.delete(connectionId);
    const pending = pendingFetches.get(connectionId);
    if (pending) {
        try { pending.controller.abort(); } catch (_) { }
        pendingFetches.delete(connectionId);
    }
}


async function fetchProjectId(accessToken, signal, provider) {
    const endpoints = CLOUD_CODE_API[provider] || CLOUD_CODE_API["gemini-cli"];
    const headers = provider === "antigravity" ? ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS : LOAD_CODE_ASSIST_HEADERS;
    const response = await fetch(endpoints.loadCodeAssist, {
        method: "POST",
        headers: { ...headers, "Authorization": `Bearer ${accessToken}` },
        body: JSON.stringify({ metadata: LOAD_CODE_ASSIST_METADATA }),
        signal
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`loadCodeAssist failed: HTTP ${response.status} ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    const projectId = extractProjectId(data);
    if (projectId) return projectId;

    let tierID = "legacy-tier";
    if (Array.isArray(data.allowedTiers)) {
        for (const tier of data.allowedTiers) {
            if (tier && typeof tier === "object" && tier.isDefault === true) {
                if (tier.id && typeof tier.id === "string" && tier.id.trim()) {
                    tierID = tier.id.trim();
                    break;
                }
            }
        }
    }

    return onboardUser(accessToken, tierID, signal, endpoints, provider);
}

async function onboardUser(accessToken, tierID, externalSignal, endpoints, provider) {
    console.log(`[ProjectId] Onboarding user with tier: ${tierID}`);

    const reqBody = { tierId: tierID, metadata: LOAD_CODE_ASSIST_METADATA };
    const headers = provider === "antigravity" ? ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS : LOAD_CODE_ASSIST_HEADERS;
    const MAX_ATTEMPTS = Number(process.env.ONBOARD_MAX_ATTEMPTS) || 2;
    const BASE_RETRY_DELAY_MS = Number(process.env.ONBOARD_RETRY_DELAY_MS) || 12_000;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (externalSignal?.aborted) return null;

        const localCtrl = new AbortController();
        const timeoutId = setTimeout(() => localCtrl.abort(), 30_000);
        const forwardAbort = () => localCtrl.abort();
        externalSignal?.addEventListener("abort", forwardAbort);

        try {
            const response = await fetch(endpoints.onboardUser, {
                method: "POST",
                headers: { ...headers, "Authorization": `Bearer ${accessToken}` },
                body: JSON.stringify(reqBody),
                signal: localCtrl.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text().catch(() => "");
                throw new Error(`onboardUser HTTP ${response.status}: ${errorText.slice(0, 200)}`);
            }

            const data = await response.json();

            if (data.done === true) {
                const projectId = extractProjectIdFromOnboard(data);
                if (projectId) {
                    console.log(`[ProjectId] Successfully onboarded, project ID: ${projectId}`);
                    return projectId;
                }
                throw new Error("onboardUser done but no project_id in response");
            }

            const jitter = Math.floor(Math.random() * 5000);
            console.log(`[ProjectId] Onboard attempt ${attempt}/${MAX_ATTEMPTS}: not done yet, waiting...`);
            await new Promise(resolve => setTimeout(resolve, BASE_RETRY_DELAY_MS + jitter));

        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === "AbortError") {
                console.warn(`[ProjectId] onboardUser attempt ${attempt} aborted (timeout or connection removed)`);
                if (externalSignal?.aborted) return null;
                continue;
            }
            if (attempt === MAX_ATTEMPTS) {
                console.warn(`[ProjectId] onboardUser failed after ${MAX_ATTEMPTS} attempts: ${error.message}`);
                return null;
            }
            const jitter = Math.floor(Math.random() * 5000);
            console.warn(`[ProjectId] onboardUser attempt ${attempt} failed: ${error.message}, retrying...`);
            await new Promise(resolve => setTimeout(resolve, BASE_RETRY_DELAY_MS + jitter));
        } finally {
            clearTimeout(timeoutId);
            externalSignal?.removeEventListener("abort", forwardAbort);
        }
    }

    return null;
}

function extractProjectId(data) {
    if (!data) return null;

    if (typeof data.cloudaicompanionProject === "string") {
        const id = data.cloudaicompanionProject.trim();
        if (id) return id;
    }

    if (data.cloudaicompanionProject && typeof data.cloudaicompanionProject === "object") {
        const id = data.cloudaicompanionProject.id;
        if (typeof id === "string" && id.trim()) return id.trim();
    }

    return null;
}

function extractProjectIdFromOnboard(data) {
    if (!data?.response) return null;

    const project = data.response.cloudaicompanionProject;

    if (typeof project === "string") {
        const id = project.trim();
        if (id) return id;
    }

    if (project && typeof project === "object") {
        const id = project.id;
        if (typeof id === "string" && id.trim()) return id.trim();
    }

    return null;
}

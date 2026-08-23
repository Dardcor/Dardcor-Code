import { afterEach, describe, expect, it, vi } from "vitest";

import { getProjectIdForConnection, removeConnection } from "../../open-sse/services/projectId.js";
import { ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS } from "../../open-sse/config/appConstants.js";

const LOAD_CODE_ASSIST_URL = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const ONBOARD_USER_URL = "https://cloudcode-pa.googleapis.com/v1internal:onboardUser";

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getProjectIdForConnection fast lookup (allowOnboarding)", () => {
  it("default lookup reaches onboardUser when loadCodeAssist has no project", async () => {
    const connectionId = "conn-default-onboard";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({})) // loadCodeAssist: no project, no tiers
      .mockResolvedValueOnce(jsonResponse({
        done: true,
        response: { cloudaicompanionProject: { id: "onboarded-project" } },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const pid = await getProjectIdForConnection(connectionId, "token", "gemini-cli");

    expect(pid).toBe("onboarded-project");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, LOAD_CODE_ASSIST_URL, expect.anything());
    expect(fetchMock).toHaveBeenNthCalledWith(2, ONBOARD_USER_URL, expect.anything());
    removeConnection(connectionId);
  });

  it("fast lookup returns null without polling onboardUser", async () => {
    const connectionId = "conn-fast-null";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({})); // loadCodeAssist: no project
    vi.stubGlobal("fetch", fetchMock);

    const pid = await getProjectIdForConnection(connectionId, "token", "antigravity", { allowOnboarding: false });

    expect(pid).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // onboardUser never reached
    expect(fetchMock).toHaveBeenCalledWith(
      LOAD_CODE_ASSIST_URL,
      expect.objectContaining({
        headers: expect.objectContaining(ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS),
      })
    );
    removeConnection(connectionId);
  });

  it("fast lookup still returns a project found by loadCodeAssist", async () => {
    const connectionId = "conn-fast-hit";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ cloudaicompanionProject: { id: "load-project" } }));
    vi.stubGlobal("fetch", fetchMock);

    const pid = await getProjectIdForConnection(connectionId, "token", "antigravity", { allowOnboarding: false });

    expect(pid).toBe("load-project");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    removeConnection(connectionId);
  });

  it("fast lookup caches the null result for later calls", async () => {
    const connectionId = "conn-fast-cache";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({})); // loadCodeAssist: no project
    vi.stubGlobal("fetch", fetchMock);

    await getProjectIdForConnection(connectionId, "token", "gemini-cli", { allowOnboarding: false });
    const pid = await getProjectIdForConnection(connectionId, "token", "gemini-cli", { allowOnboarding: false });

    expect(pid).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // second call served from cache
    removeConnection(connectionId);
  });
});

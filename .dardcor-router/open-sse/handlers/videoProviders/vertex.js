import { parseVertexSaJson, refreshVertexToken } from "../../services/tokenRefresh.js";

const DEFAULT_LOCATION = "us-central1";

const encodeJobId = (name) => Buffer.from(name, "utf8").toString("base64url");

const OPERATION_NAME_RE = /^projects\/[^/]+\/locations\/[^/]+\/publishers\/[^/]+\/models\/[^/]+\/operations\/[^/]+$/;

function modelPathOf(operationName) {
  return operationName.slice(0, operationName.indexOf("/operations/"));
}

function decodeJobId(id) {
  const raw = String(id ?? "");
  if (!raw || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  if (Buffer.from(decoded, "utf8").toString("base64url") !== raw) return null;
  return OPERATION_NAME_RE.test(decoded) ? decoded : null;
}

async function resolveAuth(credentials, log) {
  const saJson = parseVertexSaJson(credentials?.apiKey);
  const projectId =
    saJson?.project_id ||
    credentials?.projectId ||
    credentials?.providerSpecificData?.projectId;
  const location = credentials?.providerSpecificData?.location || DEFAULT_LOCATION;

  if (!projectId) {
    return { error: "Vertex video requires a project_id — use Service Account JSON or set providerSpecificData.projectId" };
  }

  let token = credentials?.accessToken;
  if (saJson) {
    const minted = await refreshVertexToken(saJson, log);
    if (!minted?.accessToken) return { error: "Vertex video: failed to mint access token from service account JSON" };
    token = minted.accessToken;
  }
  if (!token) return { error: "Vertex video requires Service Account JSON or an OAuth access token (raw API keys are not supported)" };

  return { token, projectId, location };
}

function toVertexBody(body) {
  const instance = { prompt: body.prompt };
  const image = body.image ?? body.image_url;
  if (image && typeof image === "object") {
    instance.image = image;
  } else if (typeof image === "string") {
    const match = image.match(/^data:([^;]+);base64,(.*)$/s);
    instance.image = match
      ? { bytesBase64Encoded: match[2], mimeType: match[1] }
      : { gcsUri: image };
  }
  if (body.video && typeof body.video === "object") instance.video = body.video;

  const parameters = {};
  if (body.n != null) parameters.sampleCount = Number(body.n);
  if (body.duration != null) parameters.durationSeconds = Number(body.duration);
  if (body.aspect_ratio) parameters.aspectRatio = body.aspect_ratio;
  if (body.resolution) parameters.resolution = body.resolution;
  if (body.seed != null) parameters.seed = body.seed;
  if (body.negative_prompt) parameters.negativePrompt = body.negative_prompt;
  if (body.storage_uri) parameters.storageUri = body.storage_uri;
  if (body.generate_audio != null) parameters.generateAudio = !!body.generate_audio;

  return { instances: [instance], ...(Object.keys(parameters).length ? { parameters } : {}) };
}

function fromVertexOperation(json) {
  if (!json?.name) return json;
  const id = encodeJobId(json.name);
  if (json.error) {
    return { id, request_id: id, status: "failed", error: json.error };
  }
  if (!json.done) {
    return { id, request_id: id, status: "pending" };
  }
  const samples =
    json.response?.videos ||
    json.response?.generateVideoResponse?.generatedSamples ||
    [];
  const videos = samples.map((s) => ({
    url: s.gcsUri || s.video?.uri || s.uri || null,
    b64_json: s.bytesBase64Encoded || s.video?.bytesBase64Encoded || null,
    mime_type: s.mimeType || s.video?.mimeType || "video/mp4",
  }));
  return { id, request_id: id, status: "completed", video: videos[0] || null, videos };
}

export default {
  async buildRequest({ config, action, requestId, rawBody, contentType, credentials, log }) {
    if (contentType && !contentType.includes("application/json")) {
      return { error: "Vertex video requires an application/json body" };
    }

    const auth = await resolveAuth(credentials, log);
    if (auth.error) return { error: auth.error };
    const { token, projectId, location } = auth;
    const base = (config.baseUrl || "https://aiplatform.googleapis.com").replace(/\/$/, "");
    const headers = { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` };

    if (requestId) {
      const operationName = decodeJobId(requestId);
      if (!operationName) return { error: "Invalid Vertex video job id" };
      return {
        method: "POST",
        url: `${base}/v1/${modelPathOf(operationName)}:fetchPredictOperation`,
        headers,
        body: JSON.stringify({ operationName }),
      };
    }

    if (action !== "generations") {
      return { error: `Vertex video supports 'generations' only (got '${action}')` };
    }

    let body;
    try {
      body = JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8"));
    } catch {
      return { error: "Invalid JSON body" };
    }
    if (!body.model) return { error: "Vertex video requires a model (e.g. vertex/veo-3.1-generate-preview)" };
    if (!/^[A-Za-z0-9._-]+$/.test(body.model)) return { error: "Invalid Vertex video model id" };
    if (!body.prompt && !body.image && !body.image_url) return { error: "Vertex video requires a prompt or an image" };

    return {
      method: "POST",
      url: `${base}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${body.model}:predictLongRunning`,
      headers,
      body: JSON.stringify(toVertexBody(body)),
    };
  },

  transformResponse: fromVertexOperation,
};

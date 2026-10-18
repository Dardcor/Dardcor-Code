
const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
};

export async function get(url, options = {}) {
  const response = await fetch(url, {
    method: "GET",
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    ...options,
  });
  return handleResponse(response);
}

export async function post(url, data, options = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    body: JSON.stringify(data),
    ...options,
  });
  return handleResponse(response);
}

export async function put(url, data, options = {}) {
  const response = await fetch(url, {
    method: "PUT",
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    body: JSON.stringify(data),
    ...options,
  });
  return handleResponse(response);
}

export async function del(url, options = {}) {
  const response = await fetch(url, {
    method: "DELETE",
    headers: { ...DEFAULT_HEADERS, ...options.headers },
    ...options,
  });
  return handleResponse(response);
}

async function handleResponse(response) {
  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.error || "An error occurred");
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

const api = { get, post, put, del };
export default api;


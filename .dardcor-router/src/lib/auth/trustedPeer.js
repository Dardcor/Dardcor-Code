export function hasTrustedPeerHeaders(request) {
  // Edge runtime cannot read dynamically set process.env variables.
  // We trust x-9r-real-ip because custom-server.js unconditionally strips it 
  // from incoming requests and sets it to the true socket IP.
  return Boolean(request.headers.get("x-9r-real-ip"));
}

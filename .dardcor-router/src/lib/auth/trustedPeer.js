export function hasTrustedPeerHeaders(request) {
  return Boolean((request.headers.get("x-dardcor-real-ip") || request.headers.get("x-9r-real-ip")));
}

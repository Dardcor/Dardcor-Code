export function bearerAuth(creds) {
  return { "Authorization": `Bearer ${creds.apiKey || creds.accessToken}` };
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import { fetchOidcDiscovery, getPublicOrigin, probeOidcClientSecret } from "@/lib/auth/oidc";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";

// Sensitive probe (tests the configured client secret): always require a
// valid dashboard session, regardless of requireLogin.
async function canAccessTestRoute() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  return await verifyDashboardAuthToken(token);
}

export async function POST(request) {
  try {
    if (!(await canAccessTestRoute())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const settings = await getSettings();

    // One source per draft: if the body supplies any identity field, the
    // stored client secret must never be mixed into that draft.
    const DRAFT_KEYS = ["issuerUrl", "clientId", "clientSecret", "scopes"];
    const isBodyDraft = DRAFT_KEYS.some((key) => Object.prototype.hasOwnProperty.call(body, key));

    const issuerUrl = String(isBodyDraft ? body.issuerUrl || "" : settings.oidcIssuerUrl || "").trim();
    const clientId = String(isBodyDraft ? body.clientId || "" : settings.oidcClientId || "").trim();
    const scopes = String(
      (isBodyDraft ? body.scopes : settings.oidcScopes) || "openid profile email"
    ).trim() || "openid profile email";
    const clientSecret = String(
      isBodyDraft ? body.clientSecret || "" : settings.oidcClientSecret || ""
    ).trim();

    if (!issuerUrl) {
      return NextResponse.json({ error: "Issuer URL is required" }, { status: 400 });
    }
    if (!clientId) {
      return NextResponse.json({ error: "Client ID is required" }, { status: 400 });
    }

    const discovery = await fetchOidcDiscovery(issuerUrl);
    const redirectUri = `${getPublicOrigin(request)}/api/auth/oidc/callback`;
    const secretProbe = await probeOidcClientSecret({
      tokenEndpoint: discovery.token_endpoint,
      clientId,
      clientSecret,
      redirectUri,
    });

    if (secretProbe.tested && secretProbe.valid === false) {
      return NextResponse.json({
        ok: false,
        discoveryOk: true,
        clientSecretTested: true,
        clientSecretValid: false,
        issuerUrl,
        clientId,
        scopes,
        redirectUri,
        authorizationEndpoint: discovery.authorization_endpoint || "",
        tokenEndpoint: discovery.token_endpoint || "",
        jwksUri: discovery.jwks_uri || "",
        error: `Discovery loaded, but the client secret is not valid: ${secretProbe.message}`,
      });
    }

    return NextResponse.json({
      ok: true,
      discoveryOk: true,
      clientSecretTested: secretProbe.tested,
      clientSecretValid: secretProbe.valid,
      issuerUrl,
      clientId,
      scopes,
      redirectUri,
      authorizationEndpoint: discovery.authorization_endpoint || "",
      tokenEndpoint: discovery.token_endpoint || "",
      jwksUri: discovery.jwks_uri || "",
      message: secretProbe.message,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "OIDC test failed" }, { status: 500 });
  }
}

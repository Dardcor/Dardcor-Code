// Shared "How to get the session credential" panel for web-session providers
// (chatgpt-web, claude-web, kimi-web, …). Wording derives from the provider's
// WebSessionCredentialRequirement metadata — no per-provider copy here.
// Visual style mirrors the original Kimi Web panel: same panel chrome, semantic
// ordered list, external provider link, and password-style security warning.

import PropTypes from "prop-types";

export default function WebSessionCredentialGuide({ providerName, requirement, website }) {
  const isToken = requirement.kind === "token";
  const credentialWord = isToken ? "token" : "cookie";
  const host = website ? website.replace(/^https?:\/\//, "") : null;

  return (
    <div className="rounded-lg border border-accent/20 bg-sidebar/50 p-4">
      <h3 className="font-semibold mb-2 text-sm">How to get the session credential</h3>
      <p className="text-xs text-text-muted mb-2">
        {providerName} uses a browser web session instead of an API key.
      </p>
      <p className="text-xs font-medium mb-2">
        Required {credentialWord}: <code className="font-mono">{requirement.credentialName}</code>
      </p>
      <ol className="list-decimal pl-4 text-xs text-text-muted flex flex-col gap-1">
        <li>
          Sign in to {providerName} in your browser.
          {host && (
            <>
              {" "}
              <a
                href={website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline hover:opacity-80"
              >
                Open {host}
              </a>
            </>
          )}
        </li>
        <li>
          Open your browser&apos;s developer tools and inspect a request made
          by the web app.
        </li>
        <li>
          Copy the required {credentialWord} from the provider&apos;s domain.
          {requirement.acceptsFullCookieHeader && (
            <>
              {" "}
              For cookies, copy only the Cookie header value — without the{" "}
              <code className="font-mono">Cookie:</code> prefix.
            </>
          )}
        </li>
        <li>
          Paste it here and check the connection; replace it when it
          expires.
        </li>
      </ol>
      {requirement.hintFallback && (
        <p className="text-xs text-text-muted mt-2">{requirement.hintFallback}</p>
      )}
      <p className="text-xs text-warning mt-2">
        Treat this {credentialWord} like a password — anyone who has it can use
        your {providerName} session. Never share it.
      </p>
    </div>
  );
}

WebSessionCredentialGuide.propTypes = {
  providerName: PropTypes.string.isRequired,
  requirement: PropTypes.shape({
    kind: PropTypes.oneOf(["cookie", "token"]).isRequired,
    credentialName: PropTypes.string.isRequired,
    acceptsFullCookieHeader: PropTypes.bool.isRequired,
    hintFallback: PropTypes.string,
  }).isRequired,
  website: PropTypes.string,
};

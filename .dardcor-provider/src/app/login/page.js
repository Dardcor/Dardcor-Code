"use client";

import { useState, useEffect } from "react";
import { Card, Button, Input } from "@/shared/components";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [resetHint, setResetHint] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasPassword, setHasPassword] = useState(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [authMode, setAuthMode] = useState("password");
  const [oidcConfigured, setOidcConfigured] = useState(false);
  const [oidcLoginLabel, setOidcLoginLabel] = useState("Sign in with OIDC");

  // UX hint only - the backend remains the authority on where setup is allowed.
  const isLoopback =
    typeof window !== "undefined" &&
    ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

  // Countdown for rate-limit
  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = setInterval(() => setRetryAfter((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  useEffect(() => {
    async function checkAuth() {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

      try {
        const res = await fetch(`${baseUrl}/api/auth/status`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data.authenticated === true || data.requireLogin === false) {
            window.location.assign("/dashboard");
            return;
          }
          setHasPassword(!!data.hasPassword);
          setSetupRequired(data.setupRequired === true);
          setAuthMode(data.authMode || "password");
          setOidcConfigured(data.oidcConfigured === true);
          setOidcLoginLabel(data.oidcLoginLabel || "Sign in with OIDC");
        } else {
          // Safe fallback on non-OK response to avoid infinite loading state.
          setHasPassword(true);
          setSetupRequired(false);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        setHasPassword(true);
        setSetupRequired(false);
      }
    }
    checkAuth();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResetHint("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        window.location.assign("/dashboard");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Invalid password");
        if (data.resetHint) setResetHint(data.resetHint);
        if (data.retryAfter) setRetryAfter(Number(data.retryAfter));
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // First-run local setup: create the dashboard password (isSetup contract).
  const handleSetup = async (e) => {
    e.preventDefault();
    setError("");
    setResetHint("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, isSetup: true }),
      });

      if (res.ok) {
        window.location.assign("/dashboard");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to set password");
        if (data.retryAfter) setRetryAfter(Number(data.retryAfter));
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOidcLogin = () => {
    window.location.href = "/api/auth/oidc/start";
  };

  const oidcAvailable = oidcConfigured && ["oidc", "both"].includes(authMode);
  const passwordAvailable = authMode !== "oidc" || !oidcConfigured;

  // Show loading state while checking password
  if (hasPassword === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-text-muted mt-4">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4 relative overflow-hidden">
      {/* Faint grid background */}
      <div className="landing-grid absolute inset-0 pointer-events-none" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary mb-2">Dardcor Code</h1>
          <p className="text-text-muted">
            {authMode === "oidc" && oidcConfigured
              ? "Sign in with your OIDC provider to access the dashboard"
              : setupRequired
                ? "Set a password to secure this dashboard"
                : "Enter your password to access the dashboard"}
          </p>
        </div>

        <Card>
          <div className="flex flex-col gap-4">
            {oidcAvailable && (
              <Button type="button" variant="primary" className="w-full" onClick={handleOidcLogin}>
                {oidcLoginLabel}
              </Button>
            )}

            {oidcAvailable && passwordAvailable && <div className="h-px bg-border/60" />}

            {passwordAvailable ? (
              setupRequired ? (
                isLoopback ? (
                  <form onSubmit={handleSetup} className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <label htmlFor="setup-password" className="text-sm font-medium">
                        Create password
                      </label>
                      <Input
                        id="setup-password"
                        type="password"
                        placeholder="At least 8 characters"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoFocus={!oidcAvailable}
                      />
                      <label htmlFor="setup-confirm" className="text-sm font-medium">
                        Confirm password
                      </label>
                      <Input
                        id="setup-confirm"
                        type="password"
                        placeholder="Repeat password"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                      />
                      {error && (
                        <p role="alert" className="text-xs text-red-500">
                          {error}
                        </p>
                      )}
                      {retryAfter > 0 && (
                        <p role="status" className="text-xs text-amber-600 dark:text-amber-400">
                          Locked. Retry in <span className="font-mono">{retryAfter}s</span>.
                        </p>
                      )}
                    </div>
                    <Button
                      type="submit"
                      variant="primary"
                      className="w-full"
                      loading={loading}
                      disabled={loading || !password || !confirmPassword}
                    >
                      Create password & sign in
                    </Button>
                    <p className="text-xs text-center text-text-muted">
                      This password protects the dashboard and is stored on this machine.
                    </p>
                  </form>
                ) : (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm">This dashboard has no password set yet.</p>
                    <p className="text-xs text-text-muted">
                      Password setup is only allowed from the machine running Dardcor Code.
                    </p>
                    <div className="rounded-lg border border-border/60 p-3 bg-sidebar/40 font-mono text-xs">
                      Open this dashboard through localhost in a browser on the host machine, create
                      the password there, then sign in here with it.
                    </div>
                    {error && (
                      <p role="alert" className="text-xs text-red-500">
                        {error}
                      </p>
                    )}
                  </div>
                )
              ) : (
                <form onSubmit={handleLogin} className="flex flex-col gap-4">
                  {((authMode === "oidc" && !oidcConfigured) || (authMode === "both" && !oidcConfigured)) && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                      OIDC login is enabled, but the issuer/client fields are not configured yet. Password login is still available for recovery.
                    </p>
                  )}

                  {authMode === "both" && oidcConfigured && (
                    <p className="text-xs text-text-muted text-center">
                      Password and OIDC login are both enabled.
                    </p>
                  )}

                  <div className="flex flex-col gap-2">
                    <label htmlFor="login-password" className="text-sm font-medium">
                      Password
                    </label>
                    <Input
                      id="login-password"
                      type="password"
                      placeholder="Enter password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoFocus={!oidcAvailable}
                    />
                    {error && (
                      <p role="alert" className="text-xs text-red-500">
                        {error}
                      </p>
                    )}
                    {retryAfter > 0 && (
                      <p role="status" className="text-xs text-amber-600 dark:text-amber-400">
                        Locked. Retry in <span className="font-mono">{retryAfter}s</span>.
                      </p>
                    )}
                    {(resetHint || !hasPassword) && (
                      <p className="text-xs text-text-muted">
                        {resetHint || (
                          <>
                            Forgot password? Clear the stored password via Dardcor Code CLI on the host{" "}
                            {">"} <b>Settings</b> {">"} <b>Clear Dashboard Password</b>, then set a
                            new one from the local machine.
                          </>
                        )}
                      </p>
                    )}
                    {hasPassword === false && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        First login: sign in from the host machine (localhost) with the initial
                        password to save it. Remote login is not available until then.
                      </p>
                    )}
                  </div>

                  <Button
                    type="submit"
                    variant="primary"
                    className="w-full"
                    loading={loading}
                    disabled={retryAfter > 0}
                  >
                    {retryAfter > 0 ? `Wait ${retryAfter}s` : "Login"}
                  </Button>
                </form>
              )
            ) : (
              error && (
                <p role="alert" className="text-xs text-red-500">
                  {error}
                </p>
              )
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

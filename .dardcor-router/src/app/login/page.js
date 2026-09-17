"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Input from "@/shared/components/Input";

export default function LoginPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [resetHint, setResetHint] = useState("");
  const [authMode, setAuthMode] = useState("password");
  const [ssoType, setSsoType] = useState("oidc");
  const [oidcConfigured, setOidcConfigured] = useState(false);
  const [oidcLoginLabel, setOidcLoginLabel] = useState("Sign in with OIDC");
  const [samlConfigured, setSamlConfigured] = useState(false);
  const [samlLoginLabel, setSamlLoginLabel] = useState("Sign in with SAML SSO");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function checkAuthRequirement() {
      try {
        const res = await fetch("/api/auth/status", { cache: "no-store" });
        if (!mounted) return;
        if (res.ok) {
          const data = await res.json();
          // Fresh install or login not required -> redirect straight to dashboard
          if (!data.requireLogin || data.authenticated) {
            router.replace("/dashboard");
            return;
          }
          setAuthMode(data.authMode || "password");
          setSsoType(data.ssoType || "oidc");
          setOidcConfigured(Boolean(data.oidcConfigured));
          setOidcLoginLabel(data.oidcLoginLabel || "Sign in with OIDC");
          setSamlConfigured(Boolean(data.samlConfigured));
          setSamlLoginLabel(data.samlLoginLabel || "Sign in with SAML SSO");
        } else {
          router.replace("/dashboard");
          return;
        }
      } catch {
        if (mounted) router.replace("/dashboard");
        return;
      } finally {
        if (mounted) setChecking(false);
      }
    }
    checkAuthRequirement();
    return () => {
      mounted = false;
    };
  }, [router]);

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = setInterval(() => {
      setRetryAfter((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAfter]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!password.trim() || retryAfter > 0) return;
    setLoading(true);
    setError("");
    setResetHint("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        window.location.assign("/dashboard");
      } else {
        setError(data.error || "Invalid password");
        if (data.resetHint) setResetHint(data.resetHint);
        if (data.retryAfter) setRetryAfter(Number(data.retryAfter));
      }
    } catch {
      setError("An unexpected network error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const isSsoEnabled = ["sso", "oidc", "saml", "both"].includes(authMode);
  const activeSso = ssoType || (authMode === "saml" ? "saml" : "oidc");
  const samlAvailable = isSsoEnabled && activeSso === "saml" && samlConfigured;
  const oidcAvailable = isSsoEnabled && activeSso === "oidc" && oidcConfigured;
  const ssoAvailable = samlAvailable || oidcAvailable;
  const passwordAvailable = authMode === "password" || authMode === "both" || !ssoAvailable;

  if (checking) {
    return (
      <div className="min-h-screen bg-[#09090B] flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400 text-sm">Accessing Dardcor Router...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090B] flex items-center justify-center p-4 relative overflow-hidden text-white">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-purple-900/20 via-transparent to-transparent pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-purple-600/10 border border-purple-500/20 text-purple-400 mb-3">
            <span className="material-symbols-outlined text-[26px]">router</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mb-1.5">Dardcor Router</h1>
          <p className="text-sm text-gray-400">
            {samlAvailable
              ? "Sign in with SAML 2.0 Single Sign-On"
              : oidcAvailable
              ? "Sign in with your identity provider"
              : "Enter your password to access the dashboard"}
          </p>
        </div>

        <Card className="bg-[#121216]/90 backdrop-blur border border-white/10 p-6 sm:p-7 shadow-2xl">
          <div className="flex flex-col gap-4">
            {samlAvailable && (
              <Button
                type="button"
                variant="primary"
                fullWidth
                onClick={() => (window.location.href = "/api/auth/saml/start")}
              >
                {samlLoginLabel}
              </Button>
            )}

            {oidcAvailable && (
              <Button
                type="button"
                variant="primary"
                fullWidth
                onClick={() => (window.location.href = "/api/auth/oidc/start")}
              >
                {oidcLoginLabel}
              </Button>
            )}

            {ssoAvailable && passwordAvailable && <div className="h-px bg-white/10 my-1" />}

            {passwordAvailable && (
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-gray-300">Password</label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter dashboard password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoFocus={!ssoAvailable}
                      className="w-full"
                      inputClassName="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 transition-colors"
                      tabIndex={-1}
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {showPassword ? "visibility_off" : "visibility"}
                      </span>
                    </button>
                  </div>
                  {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
                  {retryAfter > 0 && (
                    <p className="text-xs text-amber-400 mt-1">
                      Too many attempts. Retry in <span className="font-mono font-semibold">{retryAfter}s</span>.
                    </p>
                  )}
                  {resetHint && <p className="text-xs text-gray-400 mt-1">{resetHint}</p>}
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  fullWidth
                  loading={loading}
                  disabled={retryAfter > 0 || !password.trim()}
                  className="bg-purple-600 hover:bg-purple-500 text-white font-medium shadow-lg shadow-purple-900/30"
                >
                  {retryAfter > 0 ? `Wait ${retryAfter}s` : "Sign In"}
                </Button>
              </form>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

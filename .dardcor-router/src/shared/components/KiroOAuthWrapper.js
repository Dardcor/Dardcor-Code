"use client";

import { useState, useCallback } from "react";
import PropTypes from "prop-types";
import OAuthModal from "./OAuthModal";
import KiroAuthModal from "./KiroAuthModal";
import KiroSocialOAuthModal from "./KiroSocialOAuthModal";

export default function KiroOAuthWrapper({ isOpen, providerInfo, onSuccess, onClose }) {
  const [authMethod, setAuthMethod] = useState(null);
  const [socialProvider, setSocialProvider] = useState(null);
  const [idcConfig, setIdcConfig] = useState(null);

  const handleMethodSelect = useCallback((method, config) => {
    if (method === "builder-id") {
      setAuthMethod("builder-id");
    } else if (method === "idc") {
      setAuthMethod("idc");
      setIdcConfig(config);
    } else if (method === "social") {
      setAuthMethod("social");
      setSocialProvider(config.provider);
    } else if (method === "import" || method === "api-key") {
      onSuccess?.();
    }
  }, [onSuccess]);

  const handleBack = () => {
    setAuthMethod(null);
    setSocialProvider(null);
    setIdcConfig(null);
  };

  const handleSocialSuccess = () => {
    setAuthMethod(null);
    setSocialProvider(null);
    onSuccess?.();
    onClose?.();
  };

  const handleDeviceSuccess = () => {
    setAuthMethod(null);
    setIdcConfig(null);
    onSuccess?.();
    onClose?.();
  };

  if (!authMethod) {
    return (
      <KiroAuthModal
        isOpen={isOpen}
        onMethodSelect={handleMethodSelect}
        onClose={onClose}
      />
    );
  }

  if (authMethod === "builder-id" || authMethod === "idc") {
    return (
      <OAuthModal
        isOpen={isOpen}
        provider="kiro"
        providerInfo={providerInfo}
        onSuccess={handleDeviceSuccess}
        onClose={handleBack}
        idcConfig={idcConfig}
      />
    );
  }

  if (authMethod === "social" && socialProvider) {
    return (
      <KiroSocialOAuthModal
        isOpen={isOpen}
        provider={socialProvider}
        onSuccess={handleSocialSuccess}
        onClose={handleBack}
      />
    );
  }

  return null;
}

KiroOAuthWrapper.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerInfo: PropTypes.shape({
    name: PropTypes.string,
  }),
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};

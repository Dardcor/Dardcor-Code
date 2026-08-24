"use client";

import { useEffect } from "react";
import { Badge, Card, CardSkeleton, Toggle } from "@/shared/components";
import { GUARDRAILS } from "@/lib/settings/dashboardSettings";
import useSettingsStore from "@/store/settingsStore";
import { useNotificationStore } from "@/store/notificationStore";

export default function GuardrailsClient() {
  const { settings, loading, error, fetchSettings, patchSettings } = useSettingsStore();
  const notify = useNotificationStore();

  useEffect(() => {
    fetchSettings({ force: true });
  }, [fetchSettings]);

  const setGuardrail = async (guardrail, enabled) => {
    const updated = await patchSettings({ [guardrail.settingKey]: enabled });
    if (updated) notify.success(`${guardrail.name} ${enabled ? "enabled" : "disabled"}`);
    else notify.error(`Failed to update ${guardrail.name}`);
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
          <span className="material-symbols-outlined text-primary">verified_user</span>
          Guardrails
        </h1>
        <p className="text-sm text-text-muted">
          Current access and network protections enforced by this Dardcor Code instance.
        </p>
      </div>

      {loading && !settings ? (
        <CardSkeleton />
      ) : error && !settings ? (
        <Card title="Active protections" icon="security">
          <div className="flex flex-col items-center gap-2 py-6 text-center text-text-muted">
            <span className="material-symbols-outlined text-2xl text-error">error</span>
            <p className="text-sm">Unable to load guardrail settings. {error}</p>
          </div>
        </Card>
      ) : (
        <Card title="Active protections" subtitle="Configurable controls and built-in request boundaries." icon="security">
          <div className="divide-y divide-border-subtle">
            {GUARDRAILS.map((guardrail) => {
              const configurable = Boolean(guardrail.settingKey);
              const enabled = configurable ? settings?.[guardrail.settingKey] === true : guardrail.enforced;
              const locked = guardrail.settingKey === "requireApiKey" && settings?.requireApiKeyLocked === true;

              return (
                <div key={guardrail.id} className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-text-main">{guardrail.name}</p>
                      <Badge variant={enabled ? "success" : "warning"} dot size="sm">
                        {enabled ? "Enforced" : "Disabled"}
                      </Badge>
                      {locked && <Badge size="sm">Environment locked</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-text-muted">{guardrail.description}</p>
                  </div>
                  {configurable && (
                    <Toggle
                      checked={enabled}
                      onChange={(value) => setGuardrail(guardrail, value)}
                      disabled={!settings || loading || locked}
                      ariaLabel={`Toggle ${guardrail.name}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

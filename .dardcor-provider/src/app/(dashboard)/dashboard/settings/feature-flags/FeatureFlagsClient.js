"use client";

import { useEffect } from "react";
import { Card, CardSkeleton, Toggle } from "@/shared/components";
import { FEATURE_FLAGS } from "@/lib/settings/dashboardSettings";
import useSettingsStore from "@/store/settingsStore";
import { useNotificationStore } from "@/store/notificationStore";

export default function FeatureFlagsClient() {
  const { settings, loading, fetchSettings, patchSettings } = useSettingsStore();
  const notify = useNotificationStore();

  useEffect(() => {
    fetchSettings({ force: true });
  }, [fetchSettings]);

  const setFlag = async (flag, enabled) => {
    const updated = await patchSettings({ [flag.key]: enabled });
    if (updated) notify.success(`${flag.name} ${enabled ? "enabled" : "disabled"}`);
    else notify.error(`Failed to update ${flag.name}`);
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
          <span className="material-symbols-outlined text-primary">flag</span>
          Feature flags
        </h1>
        <p className="text-sm text-text-muted">
          Enable advanced router behaviors. Changes are saved immediately in MiawRouter settings.
        </p>
      </div>

      {loading && !settings ? (
        <CardSkeleton />
      ) : (
        <Card
          title="Advanced features"
          subtitle="These switches control existing request-processing features."
          icon="experiment"
        >
          <div className="divide-y divide-border-subtle">
            {FEATURE_FLAGS.map((flag) => (
              <div key={flag.key} className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="font-medium text-text-main">{flag.name}</p>
                  <p className="mt-1 text-sm text-text-muted">{flag.description}</p>
                  <code className="mt-1 block text-xs text-text-muted">{flag.key}</code>
                </div>
                <Toggle
                  checked={settings?.[flag.key] === true}
                  onChange={(enabled) => setFlag(flag, enabled)}
                  disabled={!settings || loading}
                  ariaLabel={`Toggle ${flag.name}`}
                />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

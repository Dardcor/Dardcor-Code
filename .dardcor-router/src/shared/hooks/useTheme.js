"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import useThemeStore from "@/store/themeStore";

function subscribeToSystemTheme(callback) {
  if (typeof window === "undefined") return () => {};
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
}

function getSystemThemeSnapshot() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getServerSnapshot() {
  return false;
}

export function useTheme() {
  const { theme, setTheme, toggleTheme, initTheme } = useThemeStore();

  const systemPrefersDark = useSyncExternalStore(
    subscribeToSystemTheme,
    getSystemThemeSnapshot,
    getServerSnapshot
  );

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  useEffect(() => {
    if (theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => initTheme();

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme, initTheme]);

  const isDark = theme === "dark" || (theme === "system" && systemPrefersDark);

  return {
    theme,
    setTheme,
    toggleTheme,
    isDark,
  };
}


// Dardcor Code color palette for Providers Router
// Pure black surfaces with purple accents

export const COLORS = {
  // Primary - Vibrant Purple (Dardcor Code brand)
  primary: {
    DEFAULT: "#A855F7",
    hover: "#9333EA",
    light: "#C084FC",
    dark: "#7E22CE",
  },

  // Light theme backgrounds (mapped to dark palette for consistency)
  light: {
    bg: "#09090B",
    bgAlt: "#000000",
    surface: "#121118",
    sidebar: "#09090B",
    border: "#262335",
    textMain: "#E6EAF0",
    textMuted: "#9AA4B1",
  },

  // Dark theme backgrounds
  dark: {
    bg: "#09090B",
    bgAlt: "#000000",
    surface: "#121118",
    sidebar: "#09090B",
    border: "#262335",
    textMain: "#E6EAF0",
    textMuted: "#9AA4B1",
  },

  // Status colors
  status: {
    success: "#22C55E",
    successLight: "#166534",
    successDark: "#14532D",
    warning: "#F59E0B",
    warningLight: "#92400E",
    warningDark: "#78350F",
    error: "#EF4444",
    errorLight: "#991B1B",
    errorDark: "#7F1D1D",
    info: "#60A5FA",
    infoLight: "#1E40AF",
    infoDark: "#1E3A8A",
  },
};

// CSS Variables mapping for Tailwind
export const CSS_VARIABLES = {
  light: {
    "--color-primary": COLORS.primary.DEFAULT,
    "--color-primary-hover": COLORS.primary.hover,
    "--color-bg": COLORS.dark.bg,
    "--color-bg-alt": COLORS.dark.bgAlt,
    "--color-surface": COLORS.dark.surface,
    "--color-sidebar": COLORS.dark.sidebar,
    "--color-border": COLORS.dark.border,
    "--color-text-main": COLORS.dark.textMain,
    "--color-text-muted": COLORS.dark.textMuted,
  },
  dark: {
    "--color-primary": COLORS.primary.DEFAULT,
    "--color-primary-hover": COLORS.primary.hover,
    "--color-bg": COLORS.dark.bg,
    "--color-bg-alt": COLORS.dark.bgAlt,
    "--color-surface": COLORS.dark.surface,
    "--color-sidebar": COLORS.dark.sidebar,
    "--color-border": COLORS.dark.border,
    "--color-text-main": COLORS.dark.textMain,
    "--color-text-muted": COLORS.dark.textMuted,
  },
};

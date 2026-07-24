export interface PrinterTheme {
  id: string;
  name: string;
  accent: string; // preview swatch color (hex)
  vars: {
    primary: string;
    "primary-foreground": string;
    accent: string;
    "accent-foreground": string;
    ring: string;
    "sidebar-primary": string;
    "sidebar-ring": string;
  };
}

export const themes: PrinterTheme[] = [
  {
    id: "default",
    name: "ChiTu Cyan",
    accent: "#1ab5a0",
    vars: {
      primary: "175 70% 45%",
      "primary-foreground": "220 20% 6%",
      accent: "175 70% 45%",
      "accent-foreground": "220 20% 6%",
      ring: "175 70% 45%",
      "sidebar-primary": "175 70% 45%",
      "sidebar-ring": "175 70% 45%",
    },
  },
  {
    id: "mars",
    name: "Elegoo Mars",
    accent: "#dc2626",
    vars: {
      primary: "0 72% 51%",
      "primary-foreground": "0 0% 100%",
      accent: "0 72% 51%",
      "accent-foreground": "0 0% 100%",
      ring: "0 72% 51%",
      "sidebar-primary": "0 72% 51%",
      "sidebar-ring": "0 72% 51%",
    },
  },
  {
    id: "saturn",
    name: "Elegoo Saturn",
    accent: "#eab308",
    vars: {
      primary: "48 96% 53%",
      "primary-foreground": "48 96% 8%",
      accent: "48 96% 53%",
      "accent-foreground": "48 96% 8%",
      ring: "48 96% 53%",
      "sidebar-primary": "48 96% 53%",
      "sidebar-ring": "48 96% 53%",
    },
  },
  {
    id: "photon",
    name: "Anycubic Photon",
    accent: "#22c55e",
    vars: {
      primary: "142 71% 45%",
      "primary-foreground": "142 71% 6%",
      accent: "142 71% 45%",
      "accent-foreground": "142 71% 6%",
      ring: "142 71% 45%",
      "sidebar-primary": "142 71% 45%",
      "sidebar-ring": "142 71% 45%",
    },
  },
  {
    id: "prusa",
    name: "Prusa Orange",
    accent: "#f45b00",
    vars: {
      primary: "22 100% 48%",
      "primary-foreground": "0 0% 100%",
      accent: "22 100% 48%",
      "accent-foreground": "0 0% 100%",
      ring: "22 100% 48%",
      "sidebar-primary": "22 100% 48%",
      "sidebar-ring": "22 100% 48%",
    },
  },
  {
    id: "formlabs",
    name: "Formlabs Purple",
    accent: "#a855f7",
    vars: {
      primary: "271 91% 65%",
      "primary-foreground": "0 0% 100%",
      accent: "271 91% 65%",
      "accent-foreground": "0 0% 100%",
      ring: "271 91% 65%",
      "sidebar-primary": "271 91% 65%",
      "sidebar-ring": "271 91% 65%",
    },
  },
  {
    id: "phrozen",
    name: "Phrozen Silver",
    accent: "#94a3b8",
    vars: {
      primary: "215 16% 65%",
      "primary-foreground": "222 47% 11%",
      accent: "215 16% 65%",
      "accent-foreground": "222 47% 11%",
      ring: "215 16% 65%",
      "sidebar-primary": "215 16% 65%",
      "sidebar-ring": "215 16% 65%",
    },
  },
  {
    id: "slate-blue",
    name: "Slate Blue",
    accent: "#475569",
    vars: {
      primary: "215 25% 40%",
      "primary-foreground": "0 0% 100%",
      accent: "215 25% 40%",
      "accent-foreground": "0 0% 100%",
      ring: "215 25% 40%",
      "sidebar-primary": "215 25% 40%",
      "sidebar-ring": "215 25% 40%",
    },
  },
  {
    id: "dark-cyan",
    name: "Deep Cyan",
    accent: "#0f766e",
    vars: {
      primary: "174 77% 26%",
      "primary-foreground": "0 0% 100%",
      accent: "174 77% 26%",
      "accent-foreground": "0 0% 100%",
      ring: "174 77% 26%",
      "sidebar-primary": "174 77% 26%",
      "sidebar-ring": "174 77% 26%",
    },
  },
  {
    id: "dark-magenta",
    name: "Dark Magenta",
    accent: "#86198f",
    vars: {
      primary: "295 70% 33%",
      "primary-foreground": "0 0% 100%",
      accent: "295 70% 33%",
      "accent-foreground": "0 0% 100%",
      ring: "295 70% 33%",
      "sidebar-primary": "295 70% 33%",
      "sidebar-ring": "295 70% 33%",
    },
  },
  {
    id: "dark-blue",
    name: "Midnight Blue",
    accent: "#1e3a8a",
    vars: {
      primary: "224 64% 33%",
      "primary-foreground": "0 0% 100%",
      accent: "224 64% 33%",
      "accent-foreground": "0 0% 100%",
      ring: "224 64% 33%",
      "sidebar-primary": "224 64% 33%",
      "sidebar-ring": "224 64% 33%",
    },
  },
];

const THEME_KEY = "mariner-theme";

export function getStoredThemeId(): string {
  return localStorage.getItem(THEME_KEY) || "default";
}

export function applyTheme(themeId: string) {
  const theme = themes.find((t) => t.id === themeId) || themes[0];
  const targets = [
    document.documentElement,
    document.querySelector(".dark"),
  ].filter(Boolean) as HTMLElement[];
  targets.forEach((el) => {
    Object.entries(theme.vars).forEach(([key, value]) => {
      el.style.setProperty(`--${key}`, value);
    });
  });
  localStorage.setItem(THEME_KEY, theme.id);
}
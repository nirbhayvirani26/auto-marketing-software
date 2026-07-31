"use client";

import { createTheme, type Theme } from "@mui/material/styles";

const brand = {
  main: "#5B5BD6",
  light: "#8484E8",
  dark: "#3F3FA8",
};

const accent = {
  main: "#00B8A9",
  light: "#4CD8CC",
  dark: "#00857A",
};

export function buildTheme(mode: "light" | "dark"): Theme {
  const isDark = mode === "dark";

  return createTheme({
    cssVariables: true,
    palette: {
      mode,
      primary: brand,
      secondary: accent,
      success: { main: "#2E9E5B" },
      warning: { main: "#D98324" },
      error: { main: "#D64545" },
      info: { main: "#3A86C8" },
      background: {
        default: isDark ? "#0E1015" : "#F6F7FB",
        paper: isDark ? "#171A21" : "#FFFFFF",
      },
      text: {
        primary: isDark ? "#E8EAF0" : "#1A1D26",
        secondary: isDark ? "#9AA1B1" : "#5C6478",
      },
      divider: isDark ? "rgba(255,255,255,0.10)" : "rgba(16,20,34,0.10)",
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily:
        'var(--font-inter), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      h4: { fontWeight: 700, letterSpacing: "-0.02em" },
      h5: { fontWeight: 700, letterSpacing: "-0.01em" },
      h6: { fontWeight: 650 },
      subtitle2: { fontWeight: 600 },
      button: { textTransform: "none", fontWeight: 600 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          "*::-webkit-scrollbar": { width: 10, height: 10 },
          "*::-webkit-scrollbar-thumb": {
            backgroundColor: isDark ? "#2C313C" : "#CBD0DC",
            borderRadius: 8,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none" },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            border: `1px solid ${
              isDark ? "rgba(255,255,255,0.08)" : "rgba(16,20,34,0.08)"
            }`,
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { borderRadius: 10 } },
      },
      MuiTextField: {
        defaultProps: { size: "small" },
      },
      MuiChip: {
        styleOverrides: { root: { fontWeight: 600 } },
      },
      MuiTableCell: {
        styleOverrides: {
          head: { fontWeight: 700, whiteSpace: "nowrap" },
        },
      },
    },
  });
}

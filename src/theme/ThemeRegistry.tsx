"use client";

import * as React from "react";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { buildTheme } from "./theme";

type Mode = "light" | "dark";

type ColorModeContextValue = {
  mode: Mode;
  toggleMode: () => void;
  setMode: (mode: Mode) => void;
};

const ColorModeContext = React.createContext<ColorModeContextValue>({
  mode: "light",
  toggleMode: () => {},
  setMode: () => {},
});

export function useColorMode() {
  return React.useContext(ColorModeContext);
}

const STORAGE_KEY = "am-color-mode";

export default function ThemeRegistry({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server ane pehla client render par same value joie — hydration mismatch
  // taalva mate stored/system preference effect ma read thay che.
  const [mode, setModeState] = React.useState<Mode>("light");

  React.useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Mode | null;
    if (stored === "light" || stored === "dark") {
      setModeState(stored);
      return;
    }
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setModeState(prefersDark ? "dark" : "light");
  }, []);

  const setMode = React.useCallback((next: Mode) => {
    setModeState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = React.useMemo<ColorModeContextValue>(
    () => ({
      mode,
      setMode,
      toggleMode: () => setMode(mode === "light" ? "dark" : "light"),
    }),
    [mode, setMode],
  );

  const theme = React.useMemo(() => buildTheme(mode), [mode]);

  return (
    <AppRouterCacheProvider options={{ key: "mui" }}>
      <ColorModeContext.Provider value={value}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          {children}
        </ThemeProvider>
      </ColorModeContext.Provider>
    </AppRouterCacheProvider>
  );
}

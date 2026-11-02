"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light";
const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: "dark", setTheme: () => {} });
const KEY = "spotter.theme";

/** Inline script that applies the saved theme before first paint (avoids a flash). */
export const themeScript = `try{var t=localStorage.getItem("${KEY}");if(t==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync with the pre-paint script
    setThemeState(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(KEY, t);
    } catch {}
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "light" ? "#f5f6f8" : "#101114");
  }, []);
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

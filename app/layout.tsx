import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/providers/auth";
import { ThemeProvider, themeScript } from "@/components/providers/theme";
import { ToastProvider } from "@/components/providers/toast";

export const metadata: Metadata = {
  title: { default: "Spotter — Train together", template: "%s · Spotter" },
  description: "The social network for gym enthusiasts. Share your sessions, follow friends, join communities and grow stronger together.",
  applicationName: "Spotter",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Spotter" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#101114",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>{children}</AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

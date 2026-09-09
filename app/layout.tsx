import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AuthProvider } from "@/components/AuthProvider";
import { CategoryColorProvider } from "@/components/CategoryColorProvider";
import { ClearCalendarControl } from "@/components/ClearCalendarControl";
import { CloudSyncProvider } from "@/components/CloudSyncProvider";
import { Sidebar } from "@/components/Sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Universal Dashboard",
  description: "A private, local-first calendar with optional account-based cloud backup.",
  manifest: "/manifest.json",
  applicationName: "Universal Dashboard",
  appleWebApp: {
    capable: true,
    title: "Universal Dashboard",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#059669" };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-slate-50">
        <AuthProvider>
          <CloudSyncProvider>
            <CategoryColorProvider>
              <Sidebar />
              <div className="min-h-screen pb-20 md:pb-0 md:pl-64">{children}</div>
              <ClearCalendarControl />
            </CategoryColorProvider>
          </CloudSyncProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

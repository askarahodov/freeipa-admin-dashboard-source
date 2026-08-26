import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./local-auth.css";
import "./local-auth-enhancements.css";
import "./diagnostics.css";
import "./sessions.css";
import "./local-administration-context.css";
import "./settings-tabs.css";
import "./settings-policy-editors.css";
import "./portal-interaction-layer.css";
import "./freeipa-user-browser.css";
import "./freeipa-user-bulk.css";
import "./freeipa-group-member-browser.css";
import "./operation-explorer.css";
import "./local-admin-session.css";
import "./settings-lifecycle.css";
import "./settings-source-resets.css";
import "./design-system.css";
import LocalAuthToolbar from "./LocalAuthToolbar";
import LocalAdministrationContext from "./LocalAdministrationContext";
import LocalAdminSessionBridge from "./LocalAdminSessionBridge";
import SettingsLifecycleWizard from "./SettingsLifecycleWizard";
import PortalInteractionLayer from "./PortalInteractionLayer";
import { ToastProvider } from "./ui/Toast";
import FreeIpaUserBrowser from "./FreeIpaUserBrowser";
import FreeIpaGroupMemberBrowser from "./FreeIpaGroupMemberBrowser";
import OperationExplorer from "./OperationExplorer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Admin Dashboard Softrust",
  description: "Локальная панель управления FreeIPA и автоматизациями XYOps.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ToastProvider>
          <PortalInteractionLayer />
          {children}
          <FreeIpaUserBrowser />
          <FreeIpaGroupMemberBrowser />
          <OperationExplorer />
          <LocalAdministrationContext />
          <LocalAdminSessionBridge />
          <SettingsLifecycleWizard />
          <LocalAuthToolbar />
        </ToastProvider>
      </body>
    </html>
  );
}

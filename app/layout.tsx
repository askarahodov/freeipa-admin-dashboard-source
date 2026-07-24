import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./local-auth.css";
import "./local-auth-enhancements.css";
import "./diagnostics.css";
import "./sessions.css";
import "./local-administration-context.css";
import LocalAuthToolbar from "./LocalAuthToolbar";
import LocalAdministrationContext from "./LocalAdministrationContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FreeIPA Admin — XYOps",
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
        {children}
        <LocalAdministrationContext />
        <LocalAuthToolbar />
      </body>
    </html>
  );
}

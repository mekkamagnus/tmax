import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "tmax — The Extensible Terminal Editor",
  description:
    "Vim keybindings. Lisp extensibility. Zero dependencies. A terminal-based text editor built on Bun.",
  openGraph: {
    title: "tmax — The Extensible Terminal Editor",
    description:
      "Vim keybindings. Lisp extensibility. Zero dependencies. Built on Bun.",
    type: "website",
    url: "https://tmux.mekaelturner.com",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg antialiased">{children}</body>
    </html>
  );
}

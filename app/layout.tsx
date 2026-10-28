import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NaniAI — meals that respect your health and your culture",
  description:
    "A culturally-grounded meal agent for seniors with health constraints. Qloo taste graph + a deterministic clinical-safety gate.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

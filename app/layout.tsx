import type { Metadata } from "next";
import { MetaPixel } from "@/components/analytics/meta-pixel";
import "./globals.css";

export const metadata: Metadata = {
  title: "Griot — Des histoires vraies africaines, prêtes à publier",
  description:
    "Donne un sujet. Griot écrit ton reel : accroches, script, plans, description, hashtags — prêt à coller dans Facebook et TikTok.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="min-h-full font-sans text-ink">
        {children}
        <MetaPixel />
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import ThemeRegistry from "@/theme/ThemeRegistry";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Auto Marketing",
    template: "%s · Auto Marketing",
  },
  description:
    "AI thi social media post banavo, schedule karo ane Facebook/Instagram par auto publish karo.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F7FB" },
    { media: "(prefers-color-scheme: dark)", color: "#0E1015" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.variable}>
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}

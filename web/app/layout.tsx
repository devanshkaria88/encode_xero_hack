import type { Metadata, Viewport } from "next";

import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: {
    default: "Robyn",
    template: "%s · Robyn",
  },
  description:
    "Robyn turns your calendar, contracts and transcripts into invoices in Xero.",
  icons: {
    icon: [
      {
        url:
          "data:image/svg+xml," +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#4b57cf"/><circle cx="12" cy="12" r="7" fill="none" stroke="#fff" stroke-width="1.8" opacity="0.5"/><path d="M8.5 12.2l2.4 2.4 4.6-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
          ),
      },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1320" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider delayDuration={200} skipDelayDuration={300}>
            {children}
            <Toaster position="bottom-right" richColors closeButton />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

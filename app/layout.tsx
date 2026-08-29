import type { Metadata } from "next";
import { Sora } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// Sora carries the Viewlio wordmark and every heading; body copy stays on the
// sans stack in globals.css. Loaded as a variable font so the weight range is
// available without shipping a file per weight.
const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Viewlio",
  description:
    "Viewlio reads your YouTube retention curve against the video itself and turns every drop, hold and spike into a specific fix for your next upload.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sora.variable} font-sans`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

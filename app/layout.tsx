import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Sora } from "next/font/google";
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

// Inter is the body face across the app and the only face on the landing page,
// which sets its own headings to it. Loaded as a variable font because the type
// there sits on weights the static cuts do not have: 510 and 590, between
// medium and semibold.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// The monospaced face for anything that is a technical value rather than
// writing: timestamps on a retention event, an issue-style id, a keyboard hint.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
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
      className={`${sora.variable} ${inter.variable} ${jetbrainsMono.variable} font-sans`}
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

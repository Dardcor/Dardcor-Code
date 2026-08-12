import { RootProvider } from "fumadocs-ui/provider/next";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "@/lib/source";
import type { ReactNode } from "react";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { Suspense } from "react";
import LanguageSelector from "@/shared/components/LanguageSelector";

export const metadata = {
  title: {
    template: "%s — DardcorCode Docs",
    default: "DardcorCode Documentation",
  },
  description:
    "Comprehensive documentation for DardcorCode AI gateway — setup, API, compression, deployment, and more.",
  robots: {
    index: true,
    follow: true,
  },
};

const docsLayoutOptions: BaseLayoutProps = {
  nav: {
    title: "DardcorCode Docs",
    url: "/docs",
    children: (
      <Suspense fallback={<div className="w-24 h-8" />}>
        <LanguageSelector />
      </Suspense>
    ),
  },
  links: [
    {
      text: "Docs Home",
      url: "/docs",
    },
    {
      text: "\u2190 Back to Dashboard",
      url: "/dashboard",
      secondary: true,
    },
  ],
  githubUrl: "https://github.com/diegosouzapw/DardcorCode",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootProvider
      theme={{
        defaultTheme: "dark",
        attribute: "class",
      }}
      search={{
        options: {
          api: "/docs/api/search",
        },
      }}
    >
      <DocsLayout tree={source.pageTree} {...docsLayoutOptions}>
        {children}
      </DocsLayout>
    </RootProvider>
  );
}

"use client";

import Link from "next/link";

export default function NotFound() {
  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen p-6 bg-black text-[#e6e6ef] text-center"
      role="main"
      aria-labelledby="not-found-title"
    >
      <div
        className="text-[96px] font-extrabold leading-none mb-2 bg-gradient-to-br from-[#A855F7] to-[#7C4DFF] bg-clip-text text-transparent"
        aria-hidden="true"
      >
        404
      </div>
      <h1 id="not-found-title" className="text-2xl font-semibold mb-2">
        Page not found
      </h1>
      <p className="text-[15px] text-[#a1a1aa] max-w-[400px] leading-relaxed mb-8">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <Link
          href="/dashboard"
          className="px-8 py-3 rounded-xl text-white text-sm font-medium no-underline transition-all duration-200 shadow-warm hover:-translate-y-0.5 bg-gradient-to-br from-[#6A1B9A] to-[#7C4DFF] hover:opacity-90"
          aria-label="Return to dashboard"
        >
          Go to Dashboard
        </Link>
        <Link
          href="/dashboard/providers"
          className="px-8 py-3 rounded-xl text-sm font-medium no-underline border border-[#27272a] hover:bg-[#18181b] text-[#e6e6ef] transition-colors duration-200"
          aria-label="Open providers page"
        >
          Providers
        </Link>
      </div>
    </div>
  );
}

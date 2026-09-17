"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Route-level error boundary. Catches render/runtime errors below the root
 * layout so an unexpected crash shows a friendly, recoverable panel (with the
 * real error available on demand) instead of a blank screen.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-lg p-5" style={{ background: "var(--card)", border: "1px solid var(--danger)" }}>
        <div className="flex items-center gap-2 mb-2">
          <span style={{ color: "var(--danger)", fontSize: 20, lineHeight: 1 }} aria-hidden>&#9888;</span>
          <h2 className="text-base font-semibold" style={{ color: "var(--danger)" }}>Something went wrong</h2>
        </div>
        <p className="text-sm mb-3" style={{ color: "var(--muted)" }}>
          An unexpected error interrupted this view. Your data is untouched — you can retry, or head back and try again.
        </p>

        <div className="flex flex-wrap gap-2 mb-3">
          <button className="btn btn-primary text-sm" onClick={() => reset()}>Try again</button>
          <button className="btn text-sm" onClick={() => window.location.reload()}>Reload app</button>
          <Link href="/" className="btn text-sm">Go home</Link>
        </div>

        <button className="text-xs hover:underline" style={{ color: "var(--muted)" }} onClick={() => setShowDetails((v) => !v)}>
          {showDetails ? "Hide" : "Show"} error details
        </button>
        {showDetails && (
          <pre className="mt-2 font-mono text-xs p-3 rounded whitespace-pre-wrap break-words overflow-auto" style={{ maxHeight: 200, background: "var(--background)", border: "1px solid var(--border)" }}>
            {error.message}
            {error.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>
        )}
      </div>
    </div>
  );
}

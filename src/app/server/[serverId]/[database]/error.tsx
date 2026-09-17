"use client";

import { useEffect, useState } from "react";

/**
 * Error boundary scoped to the database subtree — it renders inside the database
 * layout, so the sidebar and breadcrumb stay put while the content area shows a
 * recoverable error (common cause: the connection dropped mid-browse).
 */
export default function DatabaseError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="p-4">
      <div className="rounded-lg p-4" style={{ background: "color-mix(in srgb, var(--danger) 8%, transparent)", border: "1px solid var(--danger)" }}>
        <p className="font-semibold text-sm mb-1" style={{ color: "var(--danger)" }}>Couldn&apos;t load this view</p>
        <p className="text-sm mb-3" style={{ color: "var(--muted)" }}>
          Something went wrong talking to this database. It&apos;s often a dropped connection — retry, and check the server is still running.
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          <button className="btn btn-primary text-sm" onClick={() => reset()}>Retry</button>
          <button className="btn text-sm" onClick={() => window.location.reload()}>Reload</button>
        </div>
        <button className="text-xs hover:underline" style={{ color: "var(--muted)" }} onClick={() => setShowDetails((v) => !v)}>
          {showDetails ? "Hide" : "Show"} details
        </button>
        {showDetails && (
          <pre className="mt-2 font-mono text-xs p-3 rounded whitespace-pre-wrap break-words" style={{ background: "var(--background)", border: "1px solid var(--border)" }}>
            {error.message}
          </pre>
        )}
      </div>
    </div>
  );
}

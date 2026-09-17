"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for errors thrown in the root layout itself. It replaces
 * the whole document, so it must render its own <html>/<body> and can't rely on
 * app styles/theme tokens (they may not have loaded).
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#16191f", color: "#e3e8ef", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ maxWidth: 460, padding: 24, borderRadius: 10, border: "1px solid #f06666", background: "#23282f" }}>
          <h2 style={{ margin: "0 0 8px", color: "#f06666", fontSize: 18 }}>nextMyAdmin hit a critical error</h2>
          <p style={{ margin: "0 0 16px", fontSize: 14, color: "#97a2b0" }}>
            The application failed to start this view. Reloading usually fixes it.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => reset()}
              style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #5b9bd5", background: "#5b9bd5", color: "#0f1419", fontSize: 14, cursor: "pointer" }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #363d47", background: "transparent", color: "#e3e8ef", fontSize: 14, cursor: "pointer" }}
            >
              Reload
            </button>
          </div>
          {error?.message && (
            <pre style={{ marginTop: 16, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#97a2b0" }}>{error.message}</pre>
          )}
        </div>
      </body>
    </html>
  );
}

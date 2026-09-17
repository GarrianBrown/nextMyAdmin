import Link from "next/link";

export default function NotFound() {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <p className="text-4xl font-bold mb-1" style={{ color: "var(--primary)" }}>404</p>
        <p className="text-sm font-medium mb-1">Page not found</p>
        <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
          That server, database, or table doesn&apos;t exist here — it may have been renamed or removed.
        </p>
        <Link href="/" className="btn btn-primary text-sm">Back to home</Link>
      </div>
    </div>
  );
}

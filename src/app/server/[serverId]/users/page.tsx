import { getServerConfig } from "@/lib/db";
import Link from "next/link";
import UserManager from "@/components/UserManager";

export default async function UsersPage({ params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params;
  const server = getServerConfig(serverId);

  if (!server) {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <div
          style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)", border: "1px solid var(--danger)" }}
          className="rounded-md p-4 text-sm"
        >
          <p className="font-semibold" style={{ color: "var(--danger)" }}>Server not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <nav className="text-sm mb-6" style={{ color: "var(--muted)" }}>
        <Link href="/" className="hover:underline" style={{ color: "var(--primary)" }}>Home</Link>
        <span className="mx-1.5">&gt;</span>
        <Link href={`/server/${serverId}`} className="hover:underline" style={{ color: "var(--primary)" }}>{server.name}</Link>
        <span className="mx-1.5">&gt;</span>
        <span>Users</span>
      </nav>
      <UserManager serverId={serverId} />
    </div>
  );
}

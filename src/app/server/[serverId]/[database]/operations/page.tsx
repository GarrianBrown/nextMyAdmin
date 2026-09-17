"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import CopyDatabaseModal from "@/components/CopyDatabaseModal";
import DropDatabaseModal from "@/components/DropDatabaseModal";
import RenameDatabaseModal from "@/components/RenameDatabaseModal";

export default function OperationsPage() {
  const params = useParams<{ serverId: string; database: string }>();
  const { serverId, database } = params;
  const [copyOpen, setCopyOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const base = `/server/${serverId}/${database}`;

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card
          title="Import"
          description="Run a .sql file against this database."
        >
          <Link href={`${base}/import`} className="btn btn-primary text-sm">
            Open import
          </Link>
        </Card>

        <Card
          title="Export"
          description="Download the database (or selected tables) as SQL."
        >
          <Link href={`${base}/export`} className="btn btn-primary text-sm">
            Open export
          </Link>
        </Card>

        <Card
          title="Copy database"
          description="Duplicate this database under a new name."
        >
          <button
            type="button"
            className="btn text-sm"
            onClick={() => setCopyOpen(true)}
          >
            Copy…
          </button>
        </Card>

        <Card
          title="Rename database"
          description="Move all tables to a new database name, then drop the old name."
        >
          <button
            type="button"
            className="btn text-sm"
            onClick={() => setRenameOpen(true)}
          >
            Rename…
          </button>
        </Card>

        <Card
          title="Drop database"
          description="Permanently delete this database and all of its tables."
          danger
        >
          <button
            type="button"
            className="btn text-sm"
            onClick={() => setDropOpen(true)}
            style={{
              background: "var(--danger)",
              color: "white",
              borderColor: "var(--danger)",
            }}
          >
            Drop database…
          </button>
        </Card>
      </div>

      {copyOpen && (
        <CopyDatabaseModal
          serverId={serverId}
          database={database}
          onClose={() => setCopyOpen(false)}
        />
      )}
      {dropOpen && (
        <DropDatabaseModal
          serverId={serverId}
          database={database}
          onClose={() => setDropOpen(false)}
        />
      )}
      {renameOpen && (
        <RenameDatabaseModal
          serverId={serverId}
          database={database}
          onClose={() => setRenameOpen(false)}
        />
      )}
    </div>
  );
}

function Card({
  title,
  description,
  danger,
  children,
}: {
  title: string;
  description: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded p-4 flex flex-col gap-3"
      style={{
        background: "var(--card)",
        border: `1px solid ${danger ? "var(--danger)" : "var(--border)"}`,
      }}
    >
      <div>
        <h3 className="text-sm font-semibold" style={{ color: danger ? "var(--danger)" : undefined }}>
          {title}
        </h3>
        <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
          {description}
        </p>
      </div>
      <div className="flex">{children}</div>
    </div>
  );
}

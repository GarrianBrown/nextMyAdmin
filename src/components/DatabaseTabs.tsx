"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Engine } from "@/lib/drivers/types";
import { getCapabilities } from "@/lib/drivers/capabilities";
import { SqlIcon, StructureIcon, DiagramIcon, ExportIcon, ImportIcon, OperationsIcon, PrivilegesIcon } from "./icons";
import type { SVGProps, ComponentType } from "react";

interface Props {
  serverId: string;
  database: string;
  engine: Engine;
}

const TABLE_HIDES_TABS = new Set(["import", "export", "query", "operations", "objects", "diagram"]);

export default function DatabaseTabs({ serverId, database, engine }: Props) {
  const pathname = usePathname();
  const base = `/server/${serverId}/${database}`;
  const remainder = pathname.startsWith(base) ? pathname.slice(base.length) : "";
  const firstSegment = remainder.split("/").filter(Boolean)[0];

  // Hide tabs on table pages (first segment is a table name, not a known tab).
  if (firstSegment && !TABLE_HIDES_TABS.has(firstSegment)) {
    return null;
  }

  const caps = getCapabilities(engine);

  const tabs: { href: string; active: boolean; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [];
  if (caps.query) tabs.push({ href: base, active: !firstSegment, label: "SQL", Icon: SqlIcon });
  if (caps.query) tabs.push({ href: `${base}/objects`, active: firstSegment === "objects", label: "Objects", Icon: StructureIcon });
  if (caps.foreignKeys) tabs.push({ href: `${base}/diagram`, active: firstSegment === "diagram", label: "Diagram", Icon: DiagramIcon });
  if (caps.exportDump) tabs.push({ href: `${base}/export`, active: firstSegment === "export", label: "Export", Icon: ExportIcon });
  if (caps.importDump) tabs.push({ href: `${base}/import`, active: firstSegment === "import", label: "Import", Icon: ImportIcon });
  if (caps.renameDatabase || caps.copyDatabase)
    tabs.push({ href: `${base}/operations`, active: firstSegment === "operations", label: "Operations", Icon: OperationsIcon });
  if (caps.users) tabs.push({ href: `/server/${serverId}/users`, active: false, label: "Privileges", Icon: PrivilegesIcon });

  if (tabs.length === 0) return null;

  return (
    <nav className="pma-tabs sticky top-[22px] z-30 shrink-0 px-2">
      {tabs.map((t) => (
        <Link key={t.label} href={t.href} className="pma-tab" data-active={t.active}>
          <t.Icon />
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

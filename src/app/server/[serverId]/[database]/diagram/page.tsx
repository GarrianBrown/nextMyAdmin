"use client";

import { useParams } from "next/navigation";
import SchemaDiagram from "@/components/SchemaDiagram";

export default function DiagramPage() {
  const { serverId, database } = useParams<{ serverId: string; database: string }>();
  return (
    <div className="h-full">
      <SchemaDiagram serverId={serverId} database={database} />
    </div>
  );
}

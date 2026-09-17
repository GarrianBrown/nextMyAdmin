"use client";

import { useRouter } from "next/navigation";

interface Server {
  id: string;
  name: string;
}

export default function ServerSwitcher({ servers }: { servers: Server[] }) {
  const router = useRouter();

  return (
    <select
      className="input text-xs py-0.5 px-2"
      defaultValue=""
      onChange={(e) => {
        if (e.target.value) {
          router.push(`/server/${e.target.value}`);
          e.target.value = "";
        }
      }}
    >
      <option value="" disabled>Switch server...</option>
      {servers.map((s) => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </select>
  );
}

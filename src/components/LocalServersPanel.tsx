"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ServerIcon, PlusIcon, TrashIcon } from "./icons";

interface Engine {
  engine: string;
  label: string;
  version: string;
  binDir: string;
}
interface Instance {
  id: string;
  name: string;
  engine: string;
  port: number;
  version: string;
  status: "running" | "stopped";
}
interface Downloadable {
  engine: string;
  label: string;
  versions: string[];
  installed: boolean;
}
interface RunningServer {
  engine: string;
  label: string;
  driver: string;
  host: string;
  port: number;
  otherPorts: number[];
  pid: number;
  source: "managed" | "brew" | "external";
  serviceName?: string;
  instanceId?: string;
  name: string;
  version: string;
}
interface ServerManagerApi {
  detectEngines(): Promise<Engine[]>;
  downloadableEngines(): Promise<Downloadable[]>;
  downloadEngine(engine: string, version?: string): Promise<Engine>;
  listInstances(): Promise<Instance[]>;
  createInstance(o: { name: string; engine: string; port: number }): Promise<Instance>;
  startInstance(id: string): Promise<Instance>;
  stopInstance(id: string): Promise<Instance>;
  deleteInstance(id: string): Promise<{ ok: boolean }>;
  discoverRunning(): Promise<RunningServer[]>;
  stopRunning(desc: RunningServer): Promise<unknown>;
  connectRunning(desc: RunningServer): Promise<{ id: string; already: boolean }>;
}

const DEFAULT_PORTS: Record<string, number> = { postgres: 5432, mysql: 3306, mariadb: 3307, mongodb: 27017 };

/** The manager API is only present inside the Electron desktop app. */
function getApi(): ServerManagerApi | null {
  if (typeof window === "undefined") return null;
  const d = (window as unknown as { nextMyAdminDesktop?: { serverManager?: ServerManagerApi } }).nextMyAdminDesktop;
  return d?.serverManager ?? null;
}

export default function LocalServersPanel() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [engines, setEngines] = useState<Engine[]>([]);
  const [downloadable, setDownloadable] = useState<Downloadable[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [running, setRunning] = useState<RunningServer[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [fEngine, setFEngine] = useState("");
  const [fName, setFName] = useState("");
  const [fPort, setFPort] = useState("");

  const refresh = useCallback(async () => {
    const api = getApi();
    if (!api) return;
    const [e, d, i, r] = await Promise.all([
      api.detectEngines(),
      api.downloadableEngines(),
      api.listInstances(),
      api.discoverRunning().catch(() => [] as RunningServer[]),
    ]);
    setEngines(e);
    setDownloadable(d);
    setInstances(i);
    setRunning(r);
  }, []);

  useEffect(() => {
    if (!getApi()) return; // browser / web mode — panel is desktop-only
    setReady(true);
    refresh().catch((e) => setError(String(e?.message ?? e)));
  }, [refresh]);

  if (!ready) return null;

  async function run(id: string, fn: (api: ServerManagerApi) => Promise<unknown>) {
    const api = getApi();
    if (!api) return;
    setBusy(id);
    setError(null);
    try {
      await fn(api);
      await refresh();
      router.refresh(); // running instances are mirrored into the server list above
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function openForm() {
    const first = engines[0]?.engine ?? "";
    setFEngine(first);
    setFName("");
    setFPort(first ? String(DEFAULT_PORTS[first] ?? "") : "");
    setError(null);
    setShowForm(true);
  }

  async function create() {
    if (!fEngine || !fPort) {
      setError("Pick an engine and a port.");
      return;
    }
    await run("__create__", async (api) => {
      await api.createInstance({ name: fName.trim() || `${engines.find((e) => e.engine === fEngine)?.label} ${fPort}`, engine: fEngine, port: Number(fPort) });
      setShowForm(false);
    });
  }

  return (
    <section className="mt-8">
      <div className="flex items-center gap-2 mb-3">
        <ServerIcon style={{ width: 18, height: 18, color: "var(--primary)" }} />
        <h2 className="text-lg font-bold">Local Servers</h2>
        <span className="badge">Desktop</span>
        <button className="btn btn-primary text-sm ml-auto" onClick={openForm} disabled={engines.length === 0}>
          <PlusIcon style={{ width: 14, height: 14 }} />
          New instance
        </button>
      </div>

      {engines.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          No database engines detected. Install one (e.g. via Homebrew: <code className="font-mono">brew install postgresql@16</code>) and reopen.
        </p>
      ) : (
        <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>
          Detected:{" "}
          {engines.map((e) => (
            <span key={e.engine} className="badge mr-1">{e.label} {e.version}</span>
          ))}
        </p>
      )}

      {error && (
        <div className="rounded-md p-3 text-sm mb-3" style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)", border: "1px solid var(--danger)" }}>
          <span style={{ color: "var(--danger)" }}>{error}</span>
        </div>
      )}

      {(() => {
        // Servers running on the machine that we didn't create — brew services,
        // manual launches, anything listening on a DB port. (App-managed instances
        // are already listed below with their own Start/Stop, so exclude them here.)
        const external = running.filter((r) => r.source !== "managed");
        if (external.length === 0) return null;
        const sourceLabel = (s: RunningServer) => (s.source === "brew" ? `Homebrew · ${s.serviceName}` : "started outside the app");
        return (
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>
              Running on this machine
            </p>
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              {external.map((r) => {
                const key = `run:${r.pid}:${r.port}`;
                const isBusy = busy === key;
                return (
                  <div key={key} className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: "1px solid var(--border)", background: "var(--card)" }}>
                    <span title="running" style={{ width: 9, height: 9, borderRadius: 999, background: "var(--success)", flexShrink: 0 }} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{r.name}</div>
                      <div className="text-xs font-mono" style={{ color: "var(--muted)" }}>
                        {r.host}:{r.port} · pid {r.pid} · {sourceLabel(r)}
                      </div>
                    </div>
                    <span className="badge badge-engine ml-2">{r.engine}</span>
                    {r.version && <span className="badge ml-1">{r.version}</span>}
                    <div className="flex gap-2 ml-auto">
                      <button
                        className="btn btn-primary text-xs"
                        disabled={isBusy}
                        title="Add a connection to this server and browse it"
                        onClick={() => run(key, (a) => a.connectRunning(r))}
                      >
                        {isBusy ? "…" : "Connect"}
                      </button>
                      <button
                        className="btn text-xs"
                        style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
                        disabled={isBusy}
                        title={r.source === "brew" ? `Stop the ${r.serviceName} service` : "Stop this server"}
                        onClick={() => {
                          if (!window.confirm(`Stop ${r.name} on ${r.host}:${r.port}?${r.source === "brew" ? `\n\nThis runs "brew services stop ${r.serviceName}".` : "\n\nThis signals the process to shut down."}`)) return;
                          run(key, (a) => a.stopRunning(r));
                        }}
                      >
                        {isBusy ? "Stopping…" : "Stop"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {downloadable.some((d) => !d.installed) && (
        <div className="rounded-lg p-3 mb-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>
            Install an engine (no system setup needed)
          </p>
          <div className="flex flex-wrap gap-2">
            {downloadable.filter((d) => !d.installed).map((d) => (
              <button
                key={d.engine}
                className="btn text-xs"
                disabled={busy === `dl:${d.engine}`}
                onClick={() => run(`dl:${d.engine}`, (a) => a.downloadEngine(d.engine, d.versions[0]))}
              >
                {busy === `dl:${d.engine}` ? `Downloading ${d.label}…` : `Download ${d.label} ${d.versions[0]}`}
              </button>
            ))}
          </div>
          <p className="text-[11px] mt-2" style={{ color: "var(--muted)" }}>
            Fetches a self-contained server binary (~30–80&nbsp;MB) into the app — nothing else to install.
          </p>
        </div>
      )}

      {showForm && (
        <div className="rounded-lg p-4 mb-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-sm">
              <span className="block mb-1" style={{ color: "var(--muted)" }}>Engine</span>
              <select
                className="input w-full"
                value={fEngine}
                onChange={(e) => { setFEngine(e.target.value); setFPort(String(DEFAULT_PORTS[e.target.value] ?? "")); }}
              >
                {engines.map((e) => (
                  <option key={e.engine} value={e.engine}>{e.label} {e.version}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="block mb-1" style={{ color: "var(--muted)" }}>Name</span>
              <input className="input w-full" value={fName} placeholder="optional" onChange={(e) => setFName(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="block mb-1" style={{ color: "var(--muted)" }}>Port</span>
              <input className="input w-full font-mono" value={fPort} onChange={(e) => setFPort(e.target.value.replace(/[^0-9]/g, ""))} />
            </label>
          </div>
          <div className="flex gap-2 mt-3">
            <button className="btn btn-primary text-sm" onClick={create} disabled={busy === "__create__"}>
              {busy === "__create__" ? "Creating…" : "Create"}
            </button>
            <button className="btn text-sm" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {instances.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>No instances yet.</p>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          {instances.map((inst) => {
            const running = inst.status === "running";
            const isBusy = busy === inst.id;
            return (
              <div key={inst.id} className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: "1px solid var(--border)", background: "var(--card)" }}>
                <span
                  title={running ? "running" : "stopped"}
                  style={{ width: 9, height: 9, borderRadius: 999, background: running ? "var(--success)" : "var(--border-strong)", flexShrink: 0 }}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{inst.name}</div>
                  <div className="text-xs font-mono" style={{ color: "var(--muted)" }}>
                    127.0.0.1:{inst.port}
                  </div>
                </div>
                <span className="badge badge-engine ml-2">{inst.engine}</span>
                <div className="flex gap-2 ml-auto">
                  {running ? (
                    <button className="btn text-xs" disabled={isBusy} onClick={() => run(inst.id, (a) => a.stopInstance(inst.id))}>
                      {isBusy ? "…" : "Stop"}
                    </button>
                  ) : (
                    <button className="btn btn-primary text-xs" disabled={isBusy} onClick={() => run(inst.id, (a) => a.startInstance(inst.id))}>
                      {isBusy ? "Starting…" : "Start"}
                    </button>
                  )}
                  <button
                    className="btn text-xs"
                    style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
                    disabled={isBusy || running}
                    title={running ? "Stop before deleting" : "Delete instance and its data"}
                    onClick={() => run(inst.id, (a) => a.deleteInstance(inst.id))}
                  >
                    <TrashIcon style={{ width: 13, height: 13 }} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

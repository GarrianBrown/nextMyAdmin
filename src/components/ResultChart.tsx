"use client";

import { useMemo, useState } from "react";

/**
 * A tiny dependency-free chart for a query result set. Renders inline SVG (bar or
 * line) from a chosen label column (x) and numeric value column (y). No library —
 * keeps the bundle lean.
 */
export default function ResultChart({ rows, fields }: { rows: Record<string, unknown>[]; fields: string[] }) {
  // Columns whose values are mostly numeric make good value axes.
  const numericFields = useMemo(
    () =>
      fields.filter((f) => {
        const vals = rows.slice(0, 20).map((r) => r[f]).filter((v) => v !== null && v !== undefined && v !== "");
        if (vals.length === 0) return false;
        return vals.filter((v) => !isNaN(Number(v))).length >= Math.ceil(vals.length * 0.8);
      }),
    [fields, rows]
  );

  const [type, setType] = useState<"bar" | "line">("bar");
  const [labelCol, setLabelCol] = useState(() => fields.find((f) => !numericFields.includes(f)) ?? fields[0] ?? "");
  const [valueCol, setValueCol] = useState(() => numericFields[0] ?? fields[0] ?? "");

  const points = useMemo(() => {
    return rows
      .map((r) => ({ label: r[labelCol] === null || r[labelCol] === undefined ? "∅" : String(r[labelCol]), value: Number(r[valueCol]) }))
      .filter((p) => !isNaN(p.value))
      .slice(0, 50);
  }, [rows, labelCol, valueCol]);

  if (fields.length === 0 || rows.length === 0) {
    return <p className="text-sm p-3" style={{ color: "var(--muted)" }}>No data to chart.</p>;
  }

  const W = 720, H = 260, padL = 48, padR = 12, padT = 12, padB = 56;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxV = Math.max(0, ...points.map((p) => p.value));
  const minV = Math.min(0, ...points.map((p) => p.value));
  const range = maxV - minV || 1;
  const y = (v: number) => padT + plotH - ((v - minV) / range) * plotH;
  const n = points.length || 1;
  const step = plotW / n;
  const barW = Math.max(2, Math.min(48, step * 0.7));

  // A few horizontal gridlines with value labels.
  const ticks = 4;
  const gridVals = Array.from({ length: ticks + 1 }, (_, i) => minV + (range * i) / ticks);

  return (
    <div className="rounded-lg mb-2" style={{ border: "1px solid var(--border)", background: "var(--card)" }}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="inline-flex rounded overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          {(["bar", "line"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className="px-2 py-0.5 text-xs"
              style={{ background: type === t ? "var(--primary)" : "transparent", color: type === t ? "var(--on-primary)" : "var(--foreground)" }}
            >
              {t === "bar" ? "Bar" : "Line"}
            </button>
          ))}
        </div>
        <label className="text-xs flex items-center gap-1" style={{ color: "var(--muted)" }}>
          Label
          <select className="input text-xs py-0.5 font-mono" value={labelCol} onChange={(e) => setLabelCol(e.target.value)}>
            {fields.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="text-xs flex items-center gap-1" style={{ color: "var(--muted)" }}>
          Value
          <select className="input text-xs py-0.5 font-mono" value={valueCol} onChange={(e) => setValueCol(e.target.value)}>
            {fields.map((f) => <option key={f} value={f}>{f}{numericFields.includes(f) ? "" : " (?)"}</option>)}
          </select>
        </label>
        <span className="text-xs ml-auto" style={{ color: "var(--muted)" }}>{points.length} point{points.length === 1 ? "" : "s"}</span>
      </div>

      <div className="overflow-x-auto p-2">
        {points.length === 0 ? (
          <p className="text-sm p-3" style={{ color: "var(--muted)" }}>“{valueCol}” has no numeric values to plot.</p>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 360, maxHeight: 300 }} role="img" aria-label={`${type} chart of ${valueCol} by ${labelCol}`}>
            {gridVals.map((gv, i) => (
              <g key={i}>
                <line x1={padL} x2={W - padR} y1={y(gv)} y2={y(gv)} stroke="var(--border)" strokeWidth={1} />
                <text x={padL - 6} y={y(gv) + 3} textAnchor="end" fontSize={10} fill="var(--muted)">{formatTick(gv)}</text>
              </g>
            ))}

            {type === "bar"
              ? points.map((p, i) => {
                  const cx = padL + step * i + step / 2;
                  const top = y(Math.max(p.value, 0));
                  const bottom = y(Math.min(p.value, 0));
                  return (
                    <rect key={i} x={cx - barW / 2} y={top} width={barW} height={Math.max(1, bottom - top)} fill="var(--primary)" rx={2}>
                      <title>{p.label}: {p.value}</title>
                    </rect>
                  );
                })
              : (
                <polyline
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  points={points.map((p, i) => `${padL + step * i + step / 2},${y(p.value)}`).join(" ")}
                />
              )}
            {type === "line" && points.map((p, i) => (
              <circle key={i} cx={padL + step * i + step / 2} cy={y(p.value)} r={2.5} fill="var(--primary)">
                <title>{p.label}: {p.value}</title>
              </circle>
            ))}

            {points.map((p, i) => (
              <text
                key={i}
                x={padL + step * i + step / 2}
                y={H - padB + 14}
                textAnchor="end"
                fontSize={10}
                fill="var(--muted)"
                transform={`rotate(-40 ${padL + step * i + step / 2} ${H - padB + 14})`}
              >
                {p.label.length > 14 ? p.label.slice(0, 13) + "…" : p.label}
              </text>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}

function formatTick(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (abs >= 1_000) return (v / 1_000).toFixed(1) + "k";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

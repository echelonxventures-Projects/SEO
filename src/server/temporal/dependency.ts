/**
 * UTP Temporal Dependency engine — pure four-way (FS/SS/FF/SF) resolution with
 * integer lag minutes. Given current times for nodes and directed edges,
 * computes earliest-feasible times (longest-path style relaxation, bounded
 * iterations so cycles degrade gracefully instead of hanging).
 */

export type DepType = "FINISH_TO_START" | "START_TO_START" | "FINISH_TO_FINISH" | "START_TO_FINISH";

export type Node = { id: string; start: number; end: number }; // epoch ms
export type Edge = { from: string; to: string; type: DepType; lagMinutes: number };

export type ResolvedNode = Node & { earliestStart: number; delayMs: number; violated: boolean };

const clampIters = 64;

/** Relax edges to a fixed point; returns adjusted nodes + whether anything moved. */
export function resolveDependencies(nodes: Node[], edges: Edge[]): { nodes: ResolvedNode[]; changed: boolean; violations: string[] } {
  const byId = new Map(nodes.map((n) => [n.id, { ...n }]));
  let changed = false;
  const violations: string[] = [];

  const req = (e: Edge): number | null => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) {
      violations.push(`missing node for edge ${e.from}->${e.to}`);
      return null;
    }
    const lag = e.lagMinutes * 60_000;
    switch (e.type) {
      case "FINISH_TO_START":
        return a.end + lag; // b.start >= a.end + lag
      case "START_TO_START":
        return a.start + lag;
      case "FINISH_TO_FINISH":
        return null; // end-driven; handled below by shifting end
      case "START_TO_FINISH":
        return null;
    }
  };

  for (let iter = 0; iter < clampIters; iter++) {
    let moved = false;
    for (const e of edges) {
      const b = byId.get(e.to);
      const a = byId.get(e.from);
      if (!b || !a) continue;
      if (e.type === "FINISH_TO_START" || e.type === "START_TO_START") {
        const floor = req(e);
        if (floor == null) continue;
        const dur = b.end - b.start;
        if (b.start < floor) {
          b.start = floor;
          b.end = floor + dur;
          moved = true;
        }
      } else if (e.type === "FINISH_TO_FINISH") {
        const need = a.end + e.lagMinutes * 60_000;
        if (b.end < need) {
          b.end = need;
          moved = true;
        }
      } else if (e.type === "START_TO_FINISH") {
        const need = a.start + e.lagMinutes * 60_000;
        if (b.end < need) {
          b.end = need;
          moved = true;
        }
      }
    }
    changed = changed || moved;
    if (!moved) break;
  }

  // report residual violations (cycles / impossible constraints)
  for (const e of edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const lag = e.lagMinutes * 60_000;
    const ok =
      e.type === "FINISH_TO_START" ? b.start >= a.end + lag - 1
        : e.type === "START_TO_START" ? b.start >= a.start + lag - 1
          : e.type === "FINISH_TO_FINISH" ? b.end >= a.end + lag - 1
            : b.end >= a.start + lag - 1;
    if (!ok) violations.push(`${e.from}->${e.to} (${e.type}) unsatisfiable`);
  }

  const result: ResolvedNode[] = [...byId.values()].map((n) => {
    const orig = nodes.find((x) => x.id === n.id)!;
    return { ...n, earliestStart: n.start, delayMs: n.start - orig.start, violated: false };
  });
  return { nodes: result, changed, violations };
}

export function dependencyGraphSummary(edges: Edge[]): { total: number; byType: Record<DepType, number> } {
  const byType: Record<DepType, number> = { FINISH_TO_START: 0, START_TO_START: 0, FINISH_TO_FINISH: 0, START_TO_FINISH: 0 };
  for (const e of edges) byType[e.type]++;
  return { total: edges.length, byType };
}

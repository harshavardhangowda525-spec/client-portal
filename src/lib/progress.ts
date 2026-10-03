export type MilestoneLike = {
  status: "not_started" | "in_progress" | "awaiting_client" | "completed" | "blocked";
  weight: number;
  due_date?: string | null;
};

/** Progress is the weighted share of milestones the admin has marked completed. */
export function computeProgress(milestones: MilestoneLike[]): number {
  const total = milestones.reduce((s, m) => s + Number(m.weight), 0);
  if (total <= 0) return 0;
  const done = milestones.filter((m) => m.status === "completed").reduce((s, m) => s + Number(m.weight), 0);
  return Math.round((done / total) * 100);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isOverdue(m: { status: string; due_date?: string | null }, today = todayISO()): boolean {
  return !!m.due_date && m.status !== "completed" && m.due_date < today;
}

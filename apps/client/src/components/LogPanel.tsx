import type { ClientLogEntry } from "../ws";

type LogPanelProps = {
  entries: ClientLogEntry[];
};

export function LogPanel({ entries }: LogPanelProps) {
  const getLevelClassName = (level: ClientLogEntry["level"]) => {
    if (level === "error") {
      return "text-[#ff8d8d]";
    }

    if (level === "warn") {
      return "text-[#ffd36f]";
    }

    if (level === "success") {
      return "text-[#8df0b8]";
    }

    return "text-ctrlx-edge";
  };

  return (
    <section className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,23,34,0.96),rgba(9,14,22,0.96))] p-5 shadow-panel">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">Log Panel</p>
          <h3 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-ctrlx-text">Session Activity</h3>
          <p className="mt-2 text-xs text-ctrlx-muted">Live client events plus forwarded host diagnostics.</p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold uppercase tracking-ctrlx text-ctrlx-muted">
          {entries.length} events
        </span>
      </div>

      <div className="mt-4 grid gap-3">
        {entries.length > 0 ? (
          entries.map((entry) => (
            <div key={entry.id} className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <strong className={`text-[11px] font-semibold uppercase tracking-ctrlx ${getLevelClassName(entry.level)}`}>
                    {entry.level}
                  </strong>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">
                    {entry.source}
                  </span>
                </div>
                <span className="text-xs text-ctrlx-muted">{new Date(entry.at).toLocaleTimeString()}</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-ctrlx-text">{entry.message}</p>
            </div>
          ))
        ) : (
          <div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-sm text-ctrlx-muted">
            No logs yet. Connect to a host to begin the session.
          </div>
        )}
      </div>
    </section>
  );
}

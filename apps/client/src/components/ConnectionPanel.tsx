import type { ChangeEvent } from "react";

type ConnectionPanelProps = {
  host: string;
  sessionCode: string;
  status: string;
  connectionState: "disconnected" | "connecting" | "paired" | "error";
  onHostChange: (value: string) => void;
  onSessionCodeChange: (value: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
};

export function ConnectionPanel({
  host,
  sessionCode,
  status,
  connectionState,
  onHostChange,
  onSessionCodeChange,
  onConnect,
  onDisconnect
}: ConnectionPanelProps) {
  const badgeClassName =
    connectionState === "paired"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
      : connectionState === "connecting"
        ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
        : connectionState === "error"
          ? "border-red-400/20 bg-red-400/10 text-red-200"
          : "border-white/10 bg-white/[0.04] text-ctrlx-muted";

  return (
    <aside className="flex h-full flex-col rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,23,34,0.96),rgba(10,16,24,0.94))] p-6 shadow-panel backdrop-blur-xl">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">Connection</p>
        <h2 className="mt-4 text-[2rem] font-semibold tracking-[-0.04em] text-ctrlx-text">Session Link</h2>
        <p className="mt-3 max-w-xs text-sm leading-6 text-ctrlx-muted">
          Pair CTRLX with the host Mac using the session code shown in the Electron app.
        </p>
      </div>

      <div className="mt-8 space-y-5">
        <label className="block">
          <span className="mb-2 block text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">
            Host Address
          </span>
          <input
            value={host}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onHostChange(event.target.value)}
            className="w-full rounded-[20px] border border-white/10 bg-ctrlx-panelAlt px-4 py-3.5 text-sm text-ctrlx-text outline-none transition placeholder:text-ctrlx-muted/60 focus:border-ctrlx-accent/50 focus:bg-[#101926]"
            placeholder="localhost"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">
            Session Code
          </span>
          <input
            value={sessionCode}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onSessionCodeChange(event.target.value.toUpperCase())}
            className="w-full rounded-[20px] border border-white/10 bg-ctrlx-panelAlt px-4 py-3.5 text-sm uppercase tracking-[0.24em] text-ctrlx-text outline-none transition placeholder:text-ctrlx-muted/60 focus:border-ctrlx-accent/50 focus:bg-[#101926]"
            placeholder="ABC123"
            maxLength={6}
          />
        </label>
      </div>

      <div className="mt-7 rounded-[24px] border border-ctrlx-accent/20 bg-[linear-gradient(180deg,rgba(153,247,255,0.14),rgba(153,247,255,0.08))] p-4 shadow-glow">
        <div className="flex items-center justify-between gap-3">
          <span className="block text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">Status</span>
          <span className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-ctrlx ${badgeClassName}`}>
            {connectionState}
          </span>
        </div>
        <strong className="mt-3 block text-lg font-semibold text-ctrlx-edge">{status}</strong>
      </div>

      <div className="mt-auto grid gap-3 pt-8">
        <button
          onClick={onConnect}
          className="rounded-[20px] border border-ctrlx-accent/30 bg-[linear-gradient(180deg,rgba(153,247,255,0.18),rgba(153,247,255,0.09))] px-4 py-3.5 text-sm font-semibold text-ctrlx-edge shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_14px_30px_rgba(0,0,0,0.24)] transition hover:border-ctrlx-accent/60 hover:bg-ctrlx-accent/20"
        >
          Connect
        </button>
        <button
          onClick={onDisconnect}
          className="rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-3.5 text-sm font-semibold text-ctrlx-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition hover:border-white/20 hover:bg-white/[0.06] hover:text-ctrlx-text"
        >
          Disconnect
        </button>
      </div>
    </aside>
  );
}

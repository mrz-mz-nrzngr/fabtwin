import type { Metadata } from "next";
import Link from "next/link";
import { Foup } from "@/art/Foup";
import { INTEGRATIONS, TIER_LABEL, TIER_MEANING } from "@/integrations/catalog";
import type { Integration, Tier } from "@/integrations/catalog";

export const metadata: Metadata = {
  title: "Integrations: FabTwin",
  description: "Every input and output of FabTwin, the tier each one has earned, and how to run it.",
};

const TIER_GLYPH: Record<Tier, string> = {
  "live-tested": "M6 1 a5 5 0 1 0 0.01 0z",
  "hardware-ready": "M1.5 1.5h9v9h-9z",
  "account-ready": "M6 0.8 11.2 6 6 11.2 0.8 6z",
  "not-proven": "M6 1.2 11 10.8H1z",
};

function TierMark({ tier }: { tier: Tier }) {
  const filled = tier !== "not-proven";
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink">
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d={TIER_GLYPH[tier]} fill={filled ? "var(--color-steel)" : "none"} stroke="var(--color-steel)" strokeWidth="1.4" />
      </svg>
      {TIER_LABEL[tier]}
    </span>
  );
}

function Row({ it }: { it: Integration }) {
  return (
    <li className="border-b border-line">
      <details className="group" open={it.id === "gem"}>
        <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-4 gap-y-1 px-1 py-3 hover:bg-panel">
          <span className="min-w-[14ch] text-[15px] font-medium text-ink">{it.name}</span>
          <TierMark tier={it.tier} />
          <span className="basis-full text-[12px] text-muted md:basis-auto md:flex-1">{it.protocol}</span>
        </summary>
        <div className="grid gap-x-8 gap-y-3 px-1 pb-5 pt-1 md:grid-cols-[1.1fr_1fr]">
          <div className="flex flex-col gap-2">
            <p className="max-w-[62ch] text-[13px] leading-relaxed text-ink">{it.summary}</p>
            <p className="max-w-[62ch] text-[12px] leading-relaxed text-muted">
              <span className="font-medium text-ink">What the tier covers. </span>
              {it.scope}
            </p>
            {it.proof && (
              <p className="text-[12px] text-muted">
                Proof: <code className="num text-ink">{it.proof}</code>
              </p>
            )}
            {it.links && (
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                {it.links.map((l) => (
                  <li key={l.href}>
                    <a className="text-steel underline" href={l.href}>
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-1.5 text-[12px] font-medium text-muted">Setup</h3>
            <ol className="flex list-decimal flex-col gap-2 pl-4 text-[13px] marker:text-muted">
              {it.steps.map((s, i) => (
                <li key={i} className="pl-1">
                  <span className="text-ink">{s.text}</span>
                  {s.command && <code className="num mt-1 block overflow-x-auto whitespace-pre rounded-xs border border-line bg-raised px-2 py-1 text-[12px] text-ink">{s.command}</code>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </details>
    </li>
  );
}

export default function IntegrationsPage() {
  const inputs = INTEGRATIONS.filter((i) => i.direction === "input");
  const outputs = INTEGRATIONS.filter((i) => i.direction === "output");
  return (
    <div className="fixed inset-0 overflow-y-auto bg-bg">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel px-4 py-3">
        <Foup size={30} shell="#cfd8df" />
        <div className="leading-tight">
          <p className="text-[15px] font-semibold tracking-tight">FabTwin</p>
          <p className="text-[11px] text-muted">Integrations</p>
        </div>
        <Link href="/" className="ml-auto inline-flex min-h-11 items-center rounded-xs border border-line bg-raised px-3 text-[13px] text-ink hover:border-steel">
          Back to the console
        </Link>
      </header>
      <main className="mx-auto w-full max-w-[1100px] px-4 pb-16 pt-8">
        <h1 className="max-w-[24ch] text-[28px] font-semibold leading-tight tracking-tight">Where the data comes from and where it goes</h1>
        <p className="mt-3 max-w-[66ch] text-[14px] leading-relaxed text-muted">
          The simulator needs nothing. Live mode follows real traffic from SECS/GEM equipment, Sparkplug B or OPC UA. The API and exports hand the state of the fab to other systems. Each line carries the tier it has earned, and no line claims more than its run proves. All numbers in the console are simulated unless a live feed is connected.
        </p>

        <section aria-labelledby="tiers" className="mt-8 grid gap-6 border-y border-line py-5 md:grid-cols-[200px_1fr]">
          <h2 id="tiers" className="text-[13px] font-medium text-muted">
            What the tiers mean
          </h2>
          <dl className="grid gap-x-8 gap-y-3 md:grid-cols-2">
            {(Object.keys(TIER_LABEL) as Tier[]).map((t) => (
              <div key={t}>
                <dt>
                  <TierMark tier={t} />
                </dt>
                <dd className="mt-0.5 text-[12px] leading-relaxed text-muted">{TIER_MEANING[t]}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="inputs" className="mt-10">
          <h2 id="inputs" className="mb-1 text-[18px] font-semibold tracking-tight">
            Inputs
          </h2>
          <p className="mb-2 text-[12px] text-muted">Open the Live mode dialog in the console to connect to any of these.</p>
          <ul className="border-t border-line">
            {inputs.map((i) => (
              <Row key={i.id} it={i} />
            ))}
          </ul>
        </section>

        <section aria-labelledby="outputs" className="mt-12">
          <h2 id="outputs" className="mb-1 text-[18px] font-semibold tracking-tight">
            Outputs
          </h2>
          <p className="mb-2 text-[12px] text-muted">Read-only. The data is the simulated fab unless a live feed is configured on a self-hosted server.</p>
          <ul className="border-t border-line">
            {outputs.map((i) => (
              <Row key={i.id} it={i} />
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

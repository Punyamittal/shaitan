export function AnalyticsDashboard() {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      {["Active agents", "Tool calls", "Template builds"].map((kpi) => (
        <article key={kpi} className="rounded-lg border border-zinc-200 p-4">
          <h3 className="text-xs text-zinc-500">{kpi}</h3>
          <p className="mt-2 text-2xl font-semibold">124</p>
        </article>
      ))}
    </section>
  );
}

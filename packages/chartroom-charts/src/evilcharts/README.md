# Evil Charts — landed source (ADR-92)

The Recharts half of [Evil Charts](https://github.com/legions-developer/evilcharts),
copied in the way the library is meant to be used: a shadcn-style registry whose
components belong to the project that installs them. MIT — the upstream
licence is `LICENSE` beside this file and travels with the code.

- **Upstream:** `legions-developer/evilcharts` at `ecbd6a5`
- **Taken:** `src/registry/charts/recharts-{area,bar,composed,line,pie,radar,radial,sankey}-chart.tsx`
  and `src/registry/ui/recharts-{chart,tooltip,legend,dot,brush,background}.tsx`
- **Not taken:** the ECharts provider (ADR-8 declined ECharts; nothing here
  needs canvas), the examples, the blocks, the site.

## Local changes

Kept to what landing the source requires, so a later upstream can be diffed
in. Each is the whole of its kind:

1. **Import paths.** `@/registry/ui/…` → relative; `@/lib/utils` → `../../lib/utils`.
2. **Unused imports.** `type EvilBrushRange` removed from four charts (the
   workspace compiles with `noUnusedLocals`).
3. **Tooltip numbers.** `recharts-chart.tsx` exports `ValueFormatContext`;
   `recharts-tooltip.tsx` formats a value through it when a provider is
   present, else as upstream (`toLocaleString`). The widgets provide the
   board's formatter, so a tooltip says a number the way every tile does
   (ADR-29).
4. **Palette classes.** The sankey's inside labels used `fill-white`,
   `fill-black/60` and `dark:text-white/80`. Tailwind's palette is withdrawn
   in this workspace (ADR-48, the grid's theme bridge), so those compiled to
   nothing; they read `fill-background/60` and `text-foreground/80` instead.

Everything else — variants, motion, the compound-component APIs — is upstream
as published. Colours never come from here: the widgets hand every chart a
`ChartConfig` of the studio's series tokens (`var(--cr-sN)`).

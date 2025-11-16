# BetterCourseSchedulePlanner
A modern course filtering and sniping tool for Rutgers University.

## SOC API Probe CLI

This repository now ships a TypeScript-based probe (`scripts/soc_probe.ts`) that iterates
term/campus/subject combinations, fetches Rutgers SOC responses, and writes raw snapshots
to `data/raw/<term>-<campus>.json`. Each HTTP request is logged to `logs/soc_probe.log`
with status code, latency, and record counts, making it safe to wire into CI/cron jobs.

### Prerequisites

- Node.js 18.18+
- pnpm 9.x (see `package.json#packageManager`)

### Install dependencies

```bash
pnpm install
```

### Run a probe

```bash
pnpm ts-node --esm scripts/soc_probe.ts --config configs/soc_probe.sample.json
```

Adjust `configs/soc_probe.sample.json` (or provide another file via `--config`) to declare
custom term/campus/subject matrices and query defaults.

### Tests

```bash
pnpm test
```

The Vitest suite mocks the SOC API responses and exercises the CLI’s aggregation and error
handling paths.

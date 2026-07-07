# TABNINE.md

This project is a local React + TypeScript app for exploring inferred interservice compatibility from historical umbrella Helm repository data.

The core idea is snapshot intersection. Historical umbrella repo commits recorded chart/image versions together. Those observations are useful evidence that versions were expected to coexist, but they are not a guarantee of runtime compatibility. Use wording like "observed with" or "inferred from snapshots"; do not call results guaranteed compatibility.

## Stack

- Vite
- React
- TypeScript
- PapaParse for CSV parsing
- No backend
- Browser `localStorage` remembers the last uploaded source file contents

## Main Files

- `src/App.tsx`: UI state, upload flow, filtering controls, service grid, version drawer, compatibility result accordions.
- `src/compatibility.ts`: parsing, normalization, indexing, snapshot intersection, compatible version aggregation, date/version sorting.
- `src/App.css`: app-specific internal-tool styling.
- `src/index.css`: global theme and base styles.

## Data Sources

Preferred:
- `compatibility-snapshots.jsonl`: one historical snapshot per line.

Fallback:
- `compatibility-matrix.csv`: one historical snapshot per row.
- `compatibility-relationships.csv`: pairwise fallback only; less accurate because it lacks full snapshot context.

Normalize data into:

```ts
type Snapshot = {
  id: string
  commit: string
  shortCommit: string
  date: string
  subject?: string
  sourceHint?: string
  components: Component[]
}

type Component = {
  type: 'chart' | 'image' | string
  name: string
  version: string
  ref: string
}
```

Component refs must stay stable:

```text
<type>:<name>@<version>
```

## Filtering Model

Given selected component refs, find snapshots containing every selected ref. Compatible versions are then aggregated from those matching snapshots.

For each compatible version, show:
- observed count
- first seen
- last seen
- evidence commits/dates

The app is intentionally not a graph visualization. Keep the UI centered on fast filtering, grouped services, version selection, and evidence.

## Current UI Behavior

- Initial view shows service cards sorted alphabetically.
- User selects a service, then a version from the drawer.
- Selected refs become removable constraints.
- Result service groups are collapsed by default.
- A service with one remaining observed version shows that version in the collapsed row.
- Drawer versions sort highest/newest first.
- Component type filter supports all, images only, or charts only.
- Search filters services by name.

## Commands

```sh
npm install
npm run dev
npm run lint
npm run build
```

Run `npm run lint` and `npm run build` before finishing code changes.

## Git

The GitHub remote is:

```text
git@github.com:OpoJack/intercompatibility-checker.git
```

Main branch is `main`.

# Intercompatibility Checker

A local web app for exploring inferred interservice compatibility from historical umbrella Helm repo data.

The app loads historical snapshot data and lets you select service/chart/image versions as constraints. It then shows which other versions were observed in the same umbrella repo snapshots.

This is evidence of coexistence, not a guarantee of runtime compatibility. Git history can suggest that versions were expected to work together, but it cannot prove they actually did.

## Supported Data

- `compatibility-snapshots.jsonl`: preferred source, one historical snapshot per line.
- `compatibility-matrix.csv`: fallback, one historical snapshot per row.
- `compatibility-relationships.csv`: supported as a less accurate fallback because pairwise edges do not contain full snapshot context.

## Getting Started

```sh
npm install
npm run dev
```

Open the local Vite URL, load a compatibility data file, and select service versions to narrow the observed compatibility set.

## Useful Commands

```sh
npm run lint
npm run build
```

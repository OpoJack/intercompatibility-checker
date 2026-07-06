import Papa from 'papaparse'

export type Component = {
  type: 'chart' | 'image' | string
  name: string
  version: string
  ref: string
}

export type Snapshot = {
  id: string
  commit: string
  shortCommit: string
  date: string
  subject?: string
  sourceHint?: string
  components: Component[]
}

export type SourceKind = 'snapshots' | 'matrix' | 'relationships'

export type Indexes = {
  serviceNameToVersions: Map<string, Set<string>>
  serviceNameToTypes: Map<string, Set<string>>
  componentRefToComponent: Map<string, Component>
  componentRefToSnapshotIds: Map<string, Set<string>>
  snapshotIdToSnapshot: Map<string, Snapshot>
  serviceNameToObservationCount: Map<string, number>
}

export type ServiceSummary = {
  name: string
  types: string[]
  versionCount: number
  observationCount: number
}

export type CompatibleVersion = {
  component: Component
  observedCount: number
  firstSeen: string
  lastSeen: string
  evidence: EvidenceRow[]
}

export type EvidenceRow = {
  snapshotId: string
  commit: string
  shortCommit: string
  date: string
  subject?: string
  sourceHint?: string
}

export type CompatibleService = {
  name: string
  types: string[]
  versions: CompatibleVersion[]
}

const METADATA_COLUMNS = new Set([
  'commit',
  'short_commit',
  'shortCommit',
  'date',
  'source_hint',
  'sourceHint',
  'subject',
])

type UnknownRecord = Record<string, unknown>

/** Normalizes raw component-like input into a stable typed component shape. */
export function normalizeComponent(component: unknown): Component | null {
  if (!component || typeof component !== 'object') {
    return null
  }

  const raw = component as UnknownRecord
  const type = stringValue(raw.type) || 'component'
  const name = stringValue(raw.name)
  const version = stringValue(raw.version) || stringValue(raw.tag)

  if (!name || !version) {
    return null
  }

  return {
    type,
    name,
    version,
    ref: `${type}:${name}@${version}`,
  }
}

/** Parses compatibility-snapshots.jsonl text into normalized snapshots. */
export function parseSnapshotsJsonl(fileText: string): Snapshot[] {
  return fileText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const raw = JSON.parse(line) as UnknownRecord
      const components = normalizeSnapshotComponents(raw)
      return normalizeSnapshot(raw, components, index)
    })
    .filter((snapshot) => snapshot.components.length > 0)
}

/** Parses compatibility-matrix.csv text into normalized snapshots. */
export function parseMatrixCsv(fileText: string): Snapshot[] {
  const parsed = Papa.parse<Record<string, string>>(fileText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  })

  if (parsed.errors.length > 0) {
    const firstError = parsed.errors[0]
    throw new Error(`CSV parse failed on row ${firstError.row}: ${firstError.message}`)
  }

  return parsed.data
    .map((row, index) => {
      const components = Object.entries(row)
        .filter(([key, value]) => value && !METADATA_COLUMNS.has(key))
        .map(([key, value]) => {
          if (key.startsWith('chart:')) {
            return normalizeComponent({
              type: 'chart',
              name: key.slice('chart:'.length),
              version: value,
            })
          }

          if (key.startsWith('image:')) {
            return normalizeComponent({
              type: 'image',
              name: key.slice('image:'.length),
              version: value,
            })
          }

          return null
        })
        .filter((component): component is Component => component !== null)

      return normalizeSnapshot(row, components, index)
    })
    .filter((snapshot) => snapshot.components.length > 0)
}

/** Parses compatibility-relationships.csv as a lossy fallback by treating each edge row as a tiny snapshot. */
export function parseRelationshipsCsv(fileText: string): Snapshot[] {
  const parsed = Papa.parse<Record<string, string>>(fileText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  })

  if (parsed.errors.length > 0) {
    const firstError = parsed.errors[0]
    throw new Error(`CSV parse failed on row ${firstError.row}: ${firstError.message}`)
  }

  return parsed.data
    .map((row, index) => {
      const components = relationshipRowToComponents(row)
      return normalizeSnapshot(
        {
          commit: row.commit,
          short_commit: row.short_commit,
          date: row.date,
          source_hint: row.source_hint || 'pairwise relationship fallback',
          subject: row.subject,
        },
        components,
        index,
      )
    })
    .filter((snapshot) => snapshot.components.length > 0)
}

/** Builds lookup indexes used by the resolver and initial service grid. */
export function buildIndexes(snapshots: Snapshot[]): Indexes {
  const serviceNameToVersions = new Map<string, Set<string>>()
  const serviceNameToTypes = new Map<string, Set<string>>()
  const componentRefToComponent = new Map<string, Component>()
  const componentRefToSnapshotIds = new Map<string, Set<string>>()
  const snapshotIdToSnapshot = new Map<string, Snapshot>()
  const serviceNameToObservationCount = new Map<string, number>()

  for (const snapshot of snapshots) {
    snapshotIdToSnapshot.set(snapshot.id, snapshot)

    for (const component of snapshot.components) {
      upsertSet(serviceNameToVersions, component.name).add(component.version)
      upsertSet(serviceNameToTypes, component.name).add(component.type)
      componentRefToComponent.set(component.ref, component)
      upsertSet(componentRefToSnapshotIds, component.ref).add(snapshot.id)
      serviceNameToObservationCount.set(
        component.name,
        (serviceNameToObservationCount.get(component.name) ?? 0) + 1,
      )
    }
  }

  return {
    serviceNameToVersions,
    serviceNameToTypes,
    componentRefToComponent,
    componentRefToSnapshotIds,
    snapshotIdToSnapshot,
    serviceNameToObservationCount,
  }
}

/** Returns all known services sorted alphabetically for the initial grid. */
export function getAllServices(indexes: Indexes): ServiceSummary[] {
  return Array.from(indexes.serviceNameToVersions.entries())
    .map(([name, versions]) => ({
      name,
      types: Array.from(indexes.serviceNameToTypes.get(name) ?? []).sort(),
      versionCount: versions.size,
      observationCount: indexes.serviceNameToObservationCount.get(name) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Returns every known component version for one service sorted by version text. */
export function getVersionsForService(serviceName: string, indexes: Indexes): Component[] {
  return Array.from(indexes.componentRefToComponent.values())
    .filter((component) => component.name === serviceName)
    .sort((a, b) => naturalCompare(a.version, b.version) || a.type.localeCompare(b.type))
}

/** Finds snapshots containing every currently selected component ref. */
export function getMatchingSnapshots(selectedRefs: string[], snapshots: Snapshot[], indexes?: Indexes): Snapshot[] {
  if (selectedRefs.length === 0) {
    return snapshots
  }

  const lookup = indexes ?? buildIndexes(snapshots)
  const matchingIds = selectedRefs
    .map((ref) => lookup.componentRefToSnapshotIds.get(ref) ?? new Set<string>())
    .reduce<Set<string> | null>((intersection, ids) => {
      if (intersection === null) {
        return new Set(ids)
      }

      return new Set(Array.from(intersection).filter((id) => ids.has(id)))
    }, null)

  if (!matchingIds || matchingIds.size === 0) {
    return []
  }

  return Array.from(matchingIds)
    .map((id) => lookup.snapshotIdToSnapshot.get(id))
    .filter((snapshot): snapshot is Snapshot => snapshot !== undefined)
    .sort(compareSnapshotsByDate)
}

/** Aggregates compatible observed versions from snapshots matching selected constraints. */
export function getCompatibleVersions(
  selectedRefs: string[],
  snapshots: Snapshot[],
  indexes?: Indexes,
): CompatibleService[] {
  const matchingSnapshots = getMatchingSnapshots(selectedRefs, snapshots, indexes)
  const byServiceAndRef = new Map<string, Map<string, CompatibleVersion>>()
  const serviceTypes = new Map<string, Set<string>>()

  for (const snapshot of matchingSnapshots) {
    for (const component of snapshot.components) {
      const byRef = getOrCreate(byServiceAndRef, component.name, () => new Map<string, CompatibleVersion>())
      const existing = byRef.get(component.ref)
      const evidence = snapshotToEvidence(snapshot)

      upsertSet(serviceTypes, component.name).add(component.type)

      if (existing) {
        existing.observedCount += 1
        existing.firstSeen = earlierDate(existing.firstSeen, snapshot.date)
        existing.lastSeen = laterDate(existing.lastSeen, snapshot.date)
        existing.evidence.push(evidence)
      } else {
        byRef.set(component.ref, {
          component,
          observedCount: 1,
          firstSeen: snapshot.date,
          lastSeen: snapshot.date,
          evidence: [evidence],
        })
      }
    }
  }

  return Array.from(byServiceAndRef.entries())
    .map(([name, versionsByRef]) => ({
      name,
      types: Array.from(serviceTypes.get(name) ?? []).sort(),
      versions: Array.from(versionsByRef.values()).sort(compareCompatibleVersions),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Formats raw dates into a compact display string while tolerating missing or invalid dates. */
export function formatDate(value: string): string {
  if (!value) {
    return 'Unknown'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

/** Chooses the right parser from file name and returns normalized snapshots plus source kind. */
export function parseCompatibilityFile(fileName: string, fileText: string): { sourceKind: SourceKind; snapshots: Snapshot[] } {
  const lowerName = fileName.toLowerCase()

  if (lowerName.endsWith('.jsonl') || lowerName.includes('snapshots')) {
    return { sourceKind: 'snapshots', snapshots: parseSnapshotsJsonl(fileText) }
  }

  if (lowerName.includes('relationships')) {
    return { sourceKind: 'relationships', snapshots: parseRelationshipsCsv(fileText) }
  }

  return { sourceKind: 'matrix', snapshots: parseMatrixCsv(fileText) }
}

/** Applies the requested evidence-first version sort order. */
function compareCompatibleVersions(a: CompatibleVersion, b: CompatibleVersion): number {
  return (
    b.observedCount - a.observedCount ||
    compareDateDesc(a.lastSeen, b.lastSeen) ||
    naturalCompare(a.component.version, b.component.version)
  )
}

/** Sorts snapshots chronologically while allowing empty dates to fall last. */
function compareSnapshotsByDate(a: Snapshot, b: Snapshot): number {
  return compareDateAsc(a.date, b.date) || a.id.localeCompare(b.id)
}

/** Converts raw snapshot metadata and components into the app's snapshot shape. */
function normalizeSnapshot(raw: UnknownRecord, components: Component[], index: number): Snapshot {
  const commit = stringValue(raw.commit)
  const shortCommit = stringValue(raw.short_commit) || stringValue(raw.shortCommit) || commit.slice(0, 12)

  return {
    id: commit || `${stringValue(raw.date) || 'snapshot'}-${index}`,
    commit,
    shortCommit,
    date: stringValue(raw.date),
    subject: stringValue(raw.subject) || undefined,
    sourceHint: stringValue(raw.source_hint) || stringValue(raw.sourceHint) || undefined,
    components,
  }
}

/** Extracts components from snapshot.components, or from chart_dependencies/images fallback fields. */
function normalizeSnapshotComponents(raw: UnknownRecord): Component[] {
  if (Array.isArray(raw.components)) {
    return raw.components
      .map(normalizeComponent)
      .filter((component): component is Component => component !== null)
  }

  const chartComponents = arrayValue(raw.chart_dependencies).map((entry) =>
    normalizeComponent({
      ...(entry && typeof entry === 'object' ? (entry as UnknownRecord) : {}),
      type: 'chart',
    }),
  )

  const imageComponents = arrayValue(raw.images).map((entry) =>
    normalizeComponent({
      ...(entry && typeof entry === 'object' ? (entry as UnknownRecord) : {}),
      type: 'image',
    }),
  )

  return [...chartComponents, ...imageComponents].filter((component): component is Component => component !== null)
}

/** Converts one pairwise relationship CSV row into up to two components. */
function relationshipRowToComponents(row: Record<string, string>): Component[] {
  const candidates = [
    componentFromRelationshipColumns(row, 'source'),
    componentFromRelationshipColumns(row, 'target'),
    componentFromRelationshipColumns(row, 'from'),
    componentFromRelationshipColumns(row, 'to'),
    componentFromRelationshipColumns(row, 'left'),
    componentFromRelationshipColumns(row, 'right'),
  ].filter((component): component is Component => component !== null)

  return dedupeByRef(candidates)
}

/** Reads common source/target-style relationship column groups. */
function componentFromRelationshipColumns(row: Record<string, string>, prefix: string): Component | null {
  return normalizeComponent({
    type: row[`${prefix}_type`] || row[`${prefix}Type`] || row[`${prefix}.type`],
    name: row[`${prefix}_name`] || row[`${prefix}Name`] || row[`${prefix}.name`],
    version: row[`${prefix}_version`] || row[`${prefix}Version`] || row[`${prefix}.version`],
  })
}

/** Removes duplicate components while preserving first occurrence order. */
function dedupeByRef(components: Component[]): Component[] {
  const seen = new Set<string>()
  return components.filter((component) => {
    if (seen.has(component.ref)) {
      return false
    }

    seen.add(component.ref)
    return true
  })
}

/** Converts a snapshot into an evidence row displayed below compatible versions. */
function snapshotToEvidence(snapshot: Snapshot): EvidenceRow {
  return {
    snapshotId: snapshot.id,
    commit: snapshot.commit,
    shortCommit: snapshot.shortCommit,
    date: snapshot.date,
    subject: snapshot.subject,
    sourceHint: snapshot.sourceHint,
  }
}

/** Returns a set for map[key], creating it if needed. */
function upsertSet<TKey, TValue>(map: Map<TKey, Set<TValue>>, key: TKey): Set<TValue> {
  return getOrCreate(map, key, () => new Set<TValue>())
}

/** Returns map[key], creating it with the factory if needed. */
function getOrCreate<TKey, TValue>(map: Map<TKey, TValue>, key: TKey, factory: () => TValue): TValue {
  const existing = map.get(key)
  if (existing) {
    return existing
  }

  const value = factory()
  map.set(key, value)
  return value
}

/** Coerces unknown scalar-ish values into trimmed strings. */
function stringValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }

  return String(value).trim()
}

/** Coerces unknown array-ish fields into arrays. */
function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Chooses the earlier of two date strings, preserving non-empty unknown text. */
function earlierDate(a: string, b: string): string {
  return compareDateAsc(a, b) <= 0 ? a : b
}

/** Chooses the later of two date strings, preserving non-empty unknown text. */
function laterDate(a: string, b: string): string {
  return compareDateDesc(a, b) <= 0 ? a : b
}

/** Compares dates ascending with missing or invalid values after valid dates. */
function compareDateAsc(a: string, b: string): number {
  const aTime = dateTime(a)
  const bTime = dateTime(b)
  return aTime - bTime
}

/** Compares dates descending with missing or invalid values after valid dates. */
function compareDateDesc(a: string, b: string): number {
  const aTime = dateTime(a)
  const bTime = dateTime(b)
  return bTime - aTime
}

/** Converts date text to a comparable timestamp with unknown dates sorted last. */
function dateTime(value: string): number {
  if (!value) {
    return Number.POSITIVE_INFINITY
  }

  const time = new Date(value).getTime()
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

/** Provides natural-ish string comparison for version fallback sorting. */
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

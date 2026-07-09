import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import './App.css'
import {
  buildIndexes,
  formatDate,
  getAllServices,
  getCompatibleVersions,
  getMatchingSnapshots,
  getVersionsForService,
  parseCompatibilityFile,
  resolvePastedImageConstraints,
} from './compatibility'
import type { Component, CompatibleVersion, PastedImageConstraintResult, Snapshot, SourceKind } from './compatibility'

type LoadedSource = {
  fileName: string
  sourceKind: SourceKind
  snapshots: Snapshot[]
  restoredFromStorage?: boolean
}

type PersistedSource = {
  fileName: string
  fileText: string
}

type ComponentTypeFilter = 'all' | 'chart' | 'image'
type ObservedDisplayVersion = CompatibleVersion & {
  rowKind: 'observed'
}
type MissingDisplayVersion = {
  rowKind: 'not-observed'
  component: Component
  observedCount: 0
  firstSeen: ''
  lastSeen: ''
  evidence: []
  pastedLineNumber: number
  image: string
}
type DisplayVersion = ObservedDisplayVersion | MissingDisplayVersion
type DisplayCompatibleService = {
  name: string
  types: string[]
  versions: DisplayVersion[]
}

const EMPTY_SNAPSHOTS: Snapshot[] = []
const PERSISTED_SOURCE_KEY = 'compatibility-explorer:selected-source'

function App() {
  const [initialSourceLoad] = useState(loadPersistedSource)
  const [loadedSource, setLoadedSource] = useState<LoadedSource | null>(initialSourceLoad.loadedSource)
  const [selectedRefs, setSelectedRefs] = useState<string[]>([])
  const [selectedService, setSelectedService] = useState<string | null>(null)
  const [serviceSearch, setServiceSearch] = useState('')
  const [componentTypeFilter, setComponentTypeFilter] = useState<ComponentTypeFilter>('all')
  const [pastedImageText, setPastedImageText] = useState('')
  const [isPastePanelOpen, setIsPastePanelOpen] = useState(false)
  const [pastedImageResult, setPastedImageResult] = useState<PastedImageConstraintResult | null>(null)
  const [expandedServices, setExpandedServices] = useState<Set<string>>(new Set())
  const [expandedEvidence, setExpandedEvidence] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(initialSourceLoad.error)

  const snapshots = loadedSource?.snapshots ?? EMPTY_SNAPSHOTS
  const indexes = useMemo(() => buildIndexes(snapshots), [snapshots])
  const services = useMemo(() => getAllServices(indexes), [indexes])
  const matchingSnapshots = useMemo(
    () => getMatchingSnapshots(selectedRefs, snapshots, indexes),
    [indexes, selectedRefs, snapshots],
  )
  const compatibleServices = useMemo(
    () => getCompatibleVersions(selectedRefs, snapshots, indexes),
    [indexes, selectedRefs, snapshots],
  )
  const selectedComponents = selectedRefs
    .map((ref) => indexes.componentRefToComponent.get(ref))
    .filter((component): component is Component => component !== undefined)
  const filteredServices = services.filter(
    (service) =>
      service.name.toLowerCase().includes(serviceSearch.trim().toLowerCase()) &&
      serviceMatchesTypeFilter(service.types, componentTypeFilter),
  )
  const activeCompatibleServices = addMissingPastedVersions(
    compatibleServices.map((service) => ({
      ...service,
      versions: filterVersionsByType(service.versions, componentTypeFilter).map((version) => ({
        ...version,
        rowKind: 'observed' as const,
      })),
      types: filterTypesByType(service.types, componentTypeFilter),
    })),
    pastedImageResult,
    componentTypeFilter,
  )
    .filter(
      (service) =>
        service.versions.length > 0 && service.name.toLowerCase().includes(serviceSearch.trim().toLowerCase()),
    )
  const selectedServiceVersions = selectedService
    ? getVersionsForService(selectedService, indexes).filter((component) =>
        componentMatchesTypeFilter(component.type, componentTypeFilter),
      )
    : []

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setError(null)

    try {
      const fileText = await file.text()
      const parsed = parseCompatibilityFile(file.name, fileText)
      setLoadedSource({
        fileName: file.name,
        sourceKind: parsed.sourceKind,
        snapshots: parsed.snapshots,
      })
      try {
        persistSource(file.name, fileText)
      } catch (caught) {
        setError(caught instanceof Error ? `Loaded file, but could not remember it: ${caught.message}` : 'Loaded file, but could not remember it.')
      }
      setSelectedRefs([])
      setSelectedService(null)
      setPastedImageResult(null)
      setExpandedServices(new Set())
      setExpandedEvidence(new Set())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to parse the selected file.')
    }
  }

  const selectRef = (ref: string) => {
    setSelectedRefs((current) => (current.includes(ref) ? current : [...current, ref]))
    setSelectedService(null)
    setExpandedServices(new Set())
    setExpandedEvidence(new Set())
  }

  const removeRef = (ref: string) => {
    setSelectedRefs((current) => current.filter((selectedRef) => selectedRef !== ref))
    setExpandedServices(new Set())
    setExpandedEvidence(new Set())
  }

  const resetSelections = () => {
    setSelectedRefs([])
    setSelectedService(null)
    setPastedImageResult(null)
    setExpandedServices(new Set())
    setExpandedEvidence(new Set())
  }

  const applyPastedImageConstraints = () => {
    const result = resolvePastedImageConstraints(pastedImageText, indexes)
    const refs = Array.from(new Set(result.matched.map(({ component }) => component.ref)))

    setPastedImageResult(result)
    setSelectedRefs(refs)
    setSelectedService(null)
    setExpandedServices(new Set())
    setExpandedEvidence(new Set())
  }

  const toggleService = (serviceName: string) => {
    setExpandedServices((current) => toggleSetValue(current, serviceName))
  }

  const toggleEvidence = (versionRef: string) => {
    setExpandedEvidence((current) => toggleSetValue(current, versionRef))
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>Compatibility Explorer</h1>
          <p className="caveat">
            Compatibility is inferred from historical umbrella repo snapshots. This is evidence of coexistence,
            not proof of runtime compatibility.
          </p>
        </div>
        <label className="file-button">
          <span>Load data file</span>
          <input
            type="file"
            accept=".jsonl,.csv,application/json,text/csv,text/plain"
            onChange={handleFileChange}
          />
        </label>
      </header>

      <section className="status-bar" aria-live="polite">
        <div>
          <span className="status-label">Source</span>
          {loadedSource ? (
            <strong>
              {loadedSource.fileName}
              {loadedSource.restoredFromStorage ? <span className="restored-label">Restored</span> : null}
            </strong>
          ) : (
            <strong>No compatibility data loaded</strong>
          )}
        </div>
        <div>
          <span className="status-label">Snapshots</span>
          <strong>{snapshots.length.toLocaleString()}</strong>
        </div>
        <div>
          <span className="status-label">Services</span>
          <strong>{services.length.toLocaleString()}</strong>
        </div>
      </section>

      {loadedSource?.sourceKind === 'relationships' && (
        <div className="warning">
          Pairwise relationship CSVs do not contain full historical snapshots. Filtering is less accurate than
          JSONL snapshots or the matrix CSV.
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {loadedSource ? (
        <>
          <section className="toolbar">
            <label className="search-field">
              <span>Search services</span>
              <input
                type="search"
                value={serviceSearch}
                placeholder="user-api, enterprise-admin..."
                onChange={(event) => setServiceSearch(event.target.value)}
              />
            </label>
            <div className="type-filter" aria-label="Component type filter">
              <span>Type</span>
              <div className="segmented-control">
                <button
                  type="button"
                  className={componentTypeFilter === 'all' ? 'is-active' : ''}
                  onClick={() => setComponentTypeFilter('all')}
                >
                  Images + charts
                </button>
                <button
                  type="button"
                  className={componentTypeFilter === 'image' ? 'is-active' : ''}
                  onClick={() => setComponentTypeFilter('image')}
                >
                  Images
                </button>
                <button
                  type="button"
                  className={componentTypeFilter === 'chart' ? 'is-active' : ''}
                  onClick={() => setComponentTypeFilter('chart')}
                >
                  Charts
                </button>
              </div>
            </div>
            {selectedRefs.length > 0 && (
              <button type="button" className="secondary-button" onClick={resetSelections}>
                Reset selections
              </button>
            )}
          </section>

          <section className="paste-panel">
            <div className="paste-panel-header">
              <div className="paste-panel-copy">
                <h2>Check a pasted image set</h2>
                <p>
                  Paste image values from an environment or Helm values file. Matching image versions become active
                  constraints so you can see whether they were historically observed together.
                </p>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setIsPastePanelOpen((isOpen) => !isOpen)}
              >
                {isPastePanelOpen ? 'Hide paste field' : 'Show paste field'}
              </button>
            </div>
            {isPastePanelOpen && (
              <>
                <textarea
                  value={pastedImageText}
                  onChange={(event) => setPastedImageText(event.target.value)}
                  placeholder="myServiceImageName: &MYSERVICEIMAGENAME my-registry.company.com/project-name/my-service:0.5.0-dev"
                  spellCheck={false}
                />
                <div className="paste-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={pastedImageText.trim().length === 0}
                    onClick={applyPastedImageConstraints}
                  >
                    Apply image set
                  </button>
                  {pastedImageText && (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        setPastedImageText('')
                        setPastedImageResult(null)
                      }}
                    >
                      Clear paste
                    </button>
                  )}
                </div>
              </>
            )}
            {pastedImageResult && (
              <PastedImageResultSummary result={pastedImageResult} matchingSnapshotCount={matchingSnapshots.length} />
            )}
          </section>

          {selectedRefs.length > 0 && (
            <section className="constraint-panel">
              <div className="constraint-heading">
                <div>
                  <h2>Selected constraints</h2>
                  <span>{matchingSnapshots.length.toLocaleString()} matching snapshots</span>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={resetSelections}
                  title="Remove every active compatibility constraint"
                >
                  Remove all constraints
                </button>
              </div>
              <div className="chip-row">
                {selectedComponents.map((component) => (
                  <button
                    key={component.ref}
                    type="button"
                    className="constraint-chip"
                    onClick={() => removeRef(component.ref)}
                    title="Remove constraint"
                  >
                    <span>{component.name}</span>
                    <code>{component.version}</code>
                    <span className="chip-remove">x</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {selectedRefs.length === 0 && !pastedImageResult ? (
            <section className="service-grid" aria-label="Services">
              {filteredServices.map((service) => (
                <button
                  key={service.name}
                  type="button"
                  className={`service-card ${selectedService === service.name ? 'is-active' : ''}`}
                  onClick={() => setSelectedService(service.name)}
                >
                  <span className="service-name">{service.name}</span>
                  <span className="service-type">{service.types.join(', ') || 'component'}</span>
                  <span className="service-stats">
                    {service.versionCount.toLocaleString()} versions ·{' '}
                    {service.observationCount.toLocaleString()} observations
                  </span>
                </button>
              ))}
            </section>
          ) : (
            <CompatibleResults
              services={activeCompatibleServices}
              selectedRefs={selectedRefs}
              expandedServices={expandedServices}
              expandedEvidence={expandedEvidence}
              onSelect={selectRef}
              onToggleService={toggleService}
              onToggleEvidence={toggleEvidence}
            />
          )}

          {selectedService && selectedRefs.length === 0 && (
            <VersionDrawer
              serviceName={selectedService}
              versions={selectedServiceVersions}
              onClose={() => setSelectedService(null)}
              onSelect={selectRef}
            />
          )}
        </>
      ) : (
        <section className="empty-state">
          <h2>Load a snapshot or matrix file to begin</h2>
          <p>
            Use <code>compatibility-snapshots.jsonl</code> for the most accurate filtering. Matrix CSV files
            are also supported.
          </p>
        </section>
      )}
    </main>
  )
}

function VersionDrawer({
  serviceName,
  versions,
  onClose,
  onSelect,
}: {
  serviceName: string
  versions: Component[]
  onClose: () => void
  onSelect: (ref: string) => void
}) {
  return (
    <aside className="version-drawer" aria-label={`${serviceName} versions`}>
      <div className="drawer-header">
        <div>
          <span className="eyebrow">Select observed version</span>
          <h2>{serviceName}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close version picker">
          x
        </button>
      </div>
      <div className="version-list">
        {versions.map((component) => (
          <button key={component.ref} type="button" className="version-option" onClick={() => onSelect(component.ref)}>
            <span>{component.version}</span>
            <small>{component.type}</small>
          </button>
        ))}
      </div>
    </aside>
  )
}

function CompatibleResults({
  services,
  selectedRefs,
  expandedServices,
  expandedEvidence,
  onSelect,
  onToggleService,
  onToggleEvidence,
}: {
  services: DisplayCompatibleService[]
  selectedRefs: string[]
  expandedServices: Set<string>
  expandedEvidence: Set<string>
  onSelect: (ref: string) => void
  onToggleService: (serviceName: string) => void
  onToggleEvidence: (versionRef: string) => void
}) {
  if (services.length === 0) {
    return (
      <section className="no-results">
        <h2>No observed coexistence remains</h2>
        <p>Remove a constraint or reset selections to widen the historical snapshot set.</p>
      </section>
    )
  }

  return (
    <section className="compatible-list" aria-label="Compatible observed versions">
      {services.map((service) => {
        const expanded = expandedServices.has(service.name)
        return (
          <article key={service.name} className="accordion">
            <button type="button" className="accordion-trigger" onClick={() => onToggleService(service.name)}>
              <span>
                <strong>{service.name}</strong>
                <small>{service.types.join(', ') || 'component'}</small>
              </span>
              <span>
                <span className="version-summary">{formatServiceVersionSummary(service.versions)}</span>
                <span className="chevron">{expanded ? '−' : '+'}</span>
              </span>
            </button>
            {expanded && (
              <div className="version-table">
                <div className="table-head">
                  <span title="The observed component version.">Version</span>
                  <span title="Number of matching snapshots that include this version.">Observed</span>
                  <span title="Earliest matching snapshot where this version appears.">First seen</span>
                  <span title="Latest matching snapshot where this version appears.">Last seen</span>
                  <span title="Select this version as a constraint or view evidence commits.">Action</span>
                </div>
                {service.versions.map((version) => (
                  <VersionRow
                    key={version.component.ref}
                    version={version}
                    isSelected={selectedRefs.includes(version.component.ref)}
                    evidenceExpanded={expandedEvidence.has(version.component.ref)}
                    onSelect={onSelect}
                    onToggleEvidence={onToggleEvidence}
                  />
                ))}
              </div>
            )}
          </article>
        )
      })}
    </section>
  )
}

function PastedImageResultSummary({
  result,
  matchingSnapshotCount,
}: {
  result: PastedImageConstraintResult
  matchingSnapshotCount: number
}) {
  const totalParsed = result.matched.length + result.unmatched.length
  const observedTogether = result.matched.length > 0 && matchingSnapshotCount > 0
  const statusLabel =
    result.matched.length === 0 ? 'No matching image versions' : observedTogether ? 'Observed together' : 'Not observed together'

  return (
    <div className="paste-result">
      <div className={observedTogether ? 'paste-result-status is-observed' : 'paste-result-status'}>
        <strong>{statusLabel}</strong>
        <span>
          {result.matched.length.toLocaleString()} matched, {result.unmatched.length.toLocaleString()} not found,
          {' '}
          {result.issues.length.toLocaleString()} parse issues
        </span>
      </div>
      {totalParsed === 0 && result.issues.length === 0 && <p>No image lines found in the pasted text.</p>}
      {totalParsed > 0 && (
        <details>
          <summary>Pasted image version status</summary>
          <ul className="paste-status-list">
            {result.matched.map(({ component, pasted }) => (
              <li key={`matched-${pasted.lineNumber}-${component.ref}`}>
                <code>{pasted.name}</code>
                <span>{pasted.version}</span>
                <strong className="status-found">Found in loaded data</strong>
              </li>
            ))}
            {result.unmatched.map(({ pasted, ref }) => (
              <li key={`unmatched-${pasted.lineNumber}-${ref}`}>
                <code>{pasted.name}</code>
                <span>{pasted.version}</span>
                <strong className="status-missing">Provided version was not found in loaded data</strong>
              </li>
            ))}
          </ul>
        </details>
      )}
      {result.issues.length > 0 && (
        <details>
          <summary>Lines that could not be parsed</summary>
          <ul>
            {result.issues.map((issue) => (
              <li key={`${issue.lineNumber}-${issue.line}`}>
                Line {issue.lineNumber}: {issue.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function VersionRow({
  version,
  isSelected,
  evidenceExpanded,
  onSelect,
  onToggleEvidence,
}: {
  version: DisplayVersion
  isSelected: boolean
  evidenceExpanded: boolean
  onSelect: (ref: string) => void
  onToggleEvidence: (versionRef: string) => void
}) {
  const isNotObserved = version.rowKind === 'not-observed'

  return (
    <div className={`version-row ${isSelected ? 'is-selected' : ''} ${isNotObserved ? 'is-not-observed' : ''}`}>
      <div className="version-main">
        <code>{version.component.version}</code>
        <small>{isNotObserved ? 'image - not observed in loaded data' : version.component.type}</small>
      </div>
      <span>{isNotObserved ? 'Not observed' : version.observedCount.toLocaleString()}</span>
      <span>{isNotObserved ? '-' : formatDate(version.firstSeen)}</span>
      <span>{isNotObserved ? '-' : formatDate(version.lastSeen)}</span>
      <div className="row-actions">
        {isNotObserved ? (
          <span className="not-observed-badge">Provided version not found</span>
        ) : (
          <>
            <button
              type="button"
              className="small-button"
              disabled={isSelected}
              onClick={() => onSelect(version.component.ref)}
            >
              {isSelected ? 'Selected' : 'Select'}
            </button>
            <button type="button" className="link-button" onClick={() => onToggleEvidence(version.component.ref)}>
              Evidence
            </button>
          </>
        )}
      </div>
      {evidenceExpanded && !isNotObserved && (
        <div className="evidence-list">
          {version.evidence.map((row) => (
            <div key={`${version.component.ref}-${row.snapshotId}`} className="evidence-row">
              <code>{row.shortCommit || row.commit || row.snapshotId}</code>
              <span>{formatDate(row.date)}</span>
              <span>{row.subject || row.sourceHint || 'Historical snapshot'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatServiceVersionSummary(versions: DisplayVersion[]): string {
  if (versions.length === 1) {
    const [version] = versions
    return version.rowKind === 'not-observed' ? `${version.component.version} not observed` : version.component.version
  }

  const missingCount = versions.filter((version) => version.rowKind === 'not-observed').length
  const observedCount = versions.length - missingCount

  if (missingCount === 0) {
    return `${observedCount.toLocaleString()} observed versions`
  }

  return `${observedCount.toLocaleString()} observed, ${missingCount.toLocaleString()} not observed`
}

function serviceMatchesTypeFilter(types: string[], filter: ComponentTypeFilter): boolean {
  return filter === 'all' || types.includes(filter)
}

function componentMatchesTypeFilter(type: string, filter: ComponentTypeFilter): boolean {
  return filter === 'all' || type === filter
}

function filterVersionsByType<TVersion extends { component: Component }>(versions: TVersion[], filter: ComponentTypeFilter): TVersion[] {
  return versions.filter((version) => componentMatchesTypeFilter(version.component.type, filter))
}

function filterTypesByType(types: string[], filter: ComponentTypeFilter): string[] {
  return filter === 'all' ? types : types.filter((type) => type === filter)
}

function addMissingPastedVersions(
  services: DisplayCompatibleService[],
  pastedImageResult: PastedImageConstraintResult | null,
  filter: ComponentTypeFilter,
): DisplayCompatibleService[] {
  if (!pastedImageResult || filter === 'chart') {
    return services
  }

  const servicesByName = new Map(services.map((service) => [service.name, { ...service, versions: [...service.versions] }]))

  for (const { pasted, ref } of pastedImageResult.unmatched) {
    const component: Component = {
      type: 'image',
      name: pasted.name,
      version: pasted.version,
      ref,
    }
    const missingVersion: MissingDisplayVersion = {
      rowKind: 'not-observed',
      component,
      observedCount: 0,
      firstSeen: '',
      lastSeen: '',
      evidence: [],
      pastedLineNumber: pasted.lineNumber,
      image: pasted.image,
    }
    const service = servicesByName.get(pasted.name)

    if (service) {
      if (!service.types.includes('image')) {
        service.types = [...service.types, 'image'].sort()
      }
      if (!service.versions.some((version) => version.component.ref === ref)) {
        service.versions.push(missingVersion)
      }
    } else {
      servicesByName.set(pasted.name, {
        name: pasted.name,
        types: ['image'],
        versions: [missingVersion],
      })
    }
  }

  return Array.from(servicesByName.values())
    .map((service) => ({
      ...service,
      versions: service.versions.sort(compareDisplayVersions),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function compareDisplayVersions(a: DisplayVersion, b: DisplayVersion): number {
  if (a.rowKind !== b.rowKind) {
    return a.rowKind === 'not-observed' ? -1 : 1
  }

  return b.observedCount - a.observedCount || b.lastSeen.localeCompare(a.lastSeen) || a.component.version.localeCompare(b.component.version)
}

function toggleSetValue<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }

  return next
}

function loadPersistedSource(): { loadedSource: LoadedSource | null; error: string | null } {
  try {
    const persistedJson = window.localStorage.getItem(PERSISTED_SOURCE_KEY)
    if (!persistedJson) {
      return { loadedSource: null, error: null }
    }

    const persisted = JSON.parse(persistedJson) as PersistedSource
    if (!persisted.fileName || !persisted.fileText) {
      return { loadedSource: null, error: null }
    }

    const parsed = parseCompatibilityFile(persisted.fileName, persisted.fileText)
    return {
      loadedSource: {
        fileName: persisted.fileName,
        sourceKind: parsed.sourceKind,
        snapshots: parsed.snapshots,
        restoredFromStorage: true,
      },
      error: null,
    }
  } catch (caught) {
    return {
      loadedSource: null,
      error: caught instanceof Error ? `Unable to restore saved data file: ${caught.message}` : 'Unable to restore saved data file.',
    }
  }
}

function persistSource(fileName: string, fileText: string) {
  const persisted: PersistedSource = { fileName, fileText }
  window.localStorage.setItem(PERSISTED_SOURCE_KEY, JSON.stringify(persisted))
}

export default App

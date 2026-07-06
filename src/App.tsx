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
} from './compatibility'
import type { Component, CompatibleVersion, Snapshot, SourceKind } from './compatibility'

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

const EMPTY_SNAPSHOTS: Snapshot[] = []
const PERSISTED_SOURCE_KEY = 'compatibility-explorer:selected-source'

function App() {
  const [initialSourceLoad] = useState(loadPersistedSource)
  const [loadedSource, setLoadedSource] = useState<LoadedSource | null>(initialSourceLoad.loadedSource)
  const [selectedRefs, setSelectedRefs] = useState<string[]>([])
  const [selectedService, setSelectedService] = useState<string | null>(null)
  const [serviceSearch, setServiceSearch] = useState('')
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
  const filteredServices = services.filter((service) =>
    service.name.toLowerCase().includes(serviceSearch.trim().toLowerCase()),
  )
  const activeCompatibleServices = compatibleServices.filter((service) =>
    service.name.toLowerCase().includes(serviceSearch.trim().toLowerCase()),
  )
  const selectedServiceVersions = selectedService ? getVersionsForService(selectedService, indexes) : []

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
            {selectedRefs.length > 0 && (
              <button type="button" className="secondary-button" onClick={resetSelections}>
                Reset selections
              </button>
            )}
          </section>

          {selectedRefs.length > 0 && (
            <section className="constraint-panel">
              <div className="constraint-heading">
                <h2>Selected constraints</h2>
                <span>{matchingSnapshots.length.toLocaleString()} matching snapshots</span>
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

          {selectedRefs.length === 0 ? (
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
  services: ReturnType<typeof getCompatibleVersions>
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
                {service.versions.length.toLocaleString()} observed versions
                <span className="chevron">{expanded ? '−' : '+'}</span>
              </span>
            </button>
            {expanded && (
              <div className="version-table">
                <div className="table-head">
                  <span>Version</span>
                  <span>Observed</span>
                  <span>First seen</span>
                  <span>Last seen</span>
                  <span>Action</span>
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

function VersionRow({
  version,
  isSelected,
  evidenceExpanded,
  onSelect,
  onToggleEvidence,
}: {
  version: CompatibleVersion
  isSelected: boolean
  evidenceExpanded: boolean
  onSelect: (ref: string) => void
  onToggleEvidence: (versionRef: string) => void
}) {
  return (
    <div className={`version-row ${isSelected ? 'is-selected' : ''}`}>
      <div className="version-main">
        <code>{version.component.version}</code>
        <small>{version.component.type}</small>
      </div>
      <span>{version.observedCount.toLocaleString()}</span>
      <span>{formatDate(version.firstSeen)}</span>
      <span>{formatDate(version.lastSeen)}</span>
      <div className="row-actions">
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
      </div>
      {evidenceExpanded && (
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

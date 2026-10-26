import { useState } from 'react'
import type { ReactNode } from 'react'
import { useOrientation } from '../hooks/useOrientation'
import { useXwingLists } from '../hooks/useXwingLists'
import type { XwingList } from '../hooks/useXwingLists'
import { xwaPilots } from '../data/xwaCards'
import AppScreenLayout from './layout/appScreenLayout'
import { BackIcon, CloseIcon, SearchIcon } from './icons'
import { Button, IconButton, OptionRow, SelectButton, Sheet } from './shared/controls'
import { FactionIcon } from './factionIcon'
import { XwingSaveListSheet } from './xwingSaveListSheet'
import type { XwingPilot } from '../utils/parseXwsText'
import { FACTIONS, factionName, listPoints } from '../utils/xwingListInfo'
import { addBlock, atCurrentCost, factionShips, pilotName, POINTS_MAX, saveStatus, SHIPS_MAX, SHIPS_MIN } from '../utils/xwingListRules'
import { shipNames } from '../utils/xwaNames'

export type BuilderSide = 'player' | 'opponent'

interface Props {
  // The saved list to edit; a new list starts by choosing a faction.
  editing?: XwingList
  // A new list that starts with pilots (an import being fixed), saved under its name by default.
  start?: BuilderStart
  // Who a new list is for, when it's built from setup's list sheet.
  side?: BuilderSide
  onBack: () => void
  // The saved list's id, so setup can choose it.
  onSaved: (listId: string) => void
  onImport?: () => void
}

export interface BuilderStart {
  pilots: XwingPilot[]
  faction?: string
  name?: string
}

const FOR: Record<BuilderSide, string> = { player: 'for you', opponent: 'for your opponent' }

// A list without a faction (saved before factions were kept, or an XWS file without one) takes it
// from its first known pilot.
const factionOf = (list: { faction?: string; pilots: XwingPilot[] }) => list.faction ?? list.pilots.map(p => xwaPilots[p.name]?.faction).find(Boolean)

const rowStyle = (selected = false): React.CSSProperties => ({
  flexShrink: 0,
  minHeight: '44px',
  border: 'none',
  borderRadius: '12px',
  background: selected ? 'var(--color-tonal)' : 'var(--color-surface)',
  color: 'var(--color-text-primary)',
  fontFamily: 'inherit',
  fontSize: '0.9rem',
  padding: '0 12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  textAlign: 'left',
  cursor: 'pointer',
})

const disabledRow: React.CSSProperties = { background: 'var(--color-bg-deep)', color: 'var(--color-text-disabled)', cursor: 'default' }
const countStyle: React.CSSProperties = { fontSize: '0.75rem', color: 'var(--color-accent)' }
const subStyle: React.CSSProperties = { fontSize: '0.7rem', color: 'var(--color-text-muted)' }
const listItemStyle: React.CSSProperties = { ...rowStyle(), background: 'var(--color-surface-raised)', borderRadius: '10px', flex: 1, minWidth: 0 }
const squareStyle = (disabled = false): React.CSSProperties => ({
  ...rowStyle(), background: 'var(--color-surface-raised)', borderRadius: '10px', width: '44px', height: '44px', padding: 0, justifyContent: 'center', fontSize: '20px',
  ...(disabled ? { color: 'var(--color-text-disabled)', cursor: 'default' } : {}),
})

// The list panel scrolls when it holds more rows than fit, so its rows keep their height.
const LIST_ROW: React.CSSProperties = { display: 'flex', gap: '6px', flexShrink: 0 }

const label = (id: string) => (xwaPilots[id]?.unique ? `• ${pilotName(id)}` : pilotName(id))

type ListRow = { kind: 'single'; index: number } | { kind: 'group'; id: string; count: number }

// A unique (or unknown) pilot is a row of its own; repeats of a generic pilot share one row.
function listRows(pilots: XwingPilot[]): ListRow[] {
  const rows: ListRow[] = []
  pilots.forEach((p, index) => {
    if (xwaPilots[p.name] && !xwaPilots[p.name].unique) {
      const group = rows.find(r => r.kind === 'group' && r.id === p.name)
      if (group && group.kind === 'group') group.count++
      else rows.push({ kind: 'group', id: p.name, count: 1 })
    } else {
      rows.push({ kind: 'single', index })
    }
  })
  return rows
}

export default function XwingListBuilder({ editing, start, side, onBack, onSaved, onImport }: Props) {
  const { isPortrait } = useOrientation()
  const { lists, saveList } = useXwingLists()
  const initial = editing ?? start
  const [faction, setFaction] = useState<string | undefined>(() => (initial ? factionOf(initial) : undefined))
  const [pilots, setPilots] = useState<XwingPilot[]>(() => (initial ? atCurrentCost(initial.pilots) : []))
  const ships = faction ? factionShips(faction) : []
  const [ship, setShip] = useState<string | undefined>(() => initial?.pilots[0]?.ship)
  const shownShip = ships.find(s => s.ship === ship) ?? ships[0]
  const [search, setSearch] = useState('')
  const [swapIndex, setSwapIndex] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [shipSheet, setShipSheet] = useState(false)

  const forWhom = side ? FOR[side] : undefined

  if (faction === undefined) {
    return (
      <AppScreenLayout>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', overflowY: 'auto', color: 'var(--color-text-primary)' }}>
          <Header onBack={onBack} title={<h1 style={titleStyle}>New list</h1>} subtitle={forWhom ? `${forWhom[0].toUpperCase()}${forWhom.slice(1)} · choose a faction` : 'Choose a faction'} />
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${isPortrait ? 2 : 4}, minmax(0, 1fr))`, gap: '8px' }}>
            {FACTIONS.map(f => (
              <button key={f} type="button" data-testid={`faction-${f}`} onClick={() => setFaction(f)} style={{ ...rowStyle(), minHeight: '72px', justifyContent: 'flex-start', gap: '12px' }}>
                <FactionIcon faction={f} size={36} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span>{factionName(f)}</span>
                  <span style={subStyle}>{factionShips(f).length} ships</span>
                </span>
              </button>
            ))}
            {onImport && (
              <div style={{ ...rowStyle(), minHeight: '72px', cursor: 'default', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', padding: '8px 12px', gap: '6px' }}>
                <span style={subStyle}>Built it in another squad builder?</span>
                <Button onClick={onImport}>Import XWS</Button>
              </div>
            )}
          </div>
        </div>
      </AppScreenLayout>
    )
  }

  const total = listPoints(pilots)
  const status = saveStatus(pilots)
  const savedTotal = editing ? listPoints(editing.pilots) : undefined
  const costsChanged = savedTotal !== undefined && savedTotal !== total && total > POINTS_MAX
  const message = costsChanged ? `${status.message}: costs have changed` : status.message
  const swapping = swapIndex !== null ? pilots[swapIndex] : undefined
  const others = swapIndex !== null ? pilots.filter((_, i) => i !== swapIndex) : pilots
  const atCap = swapIndex === null && pilots.length >= SHIPS_MAX
  const countOf = (id: string) => pilots.filter(p => p.name === id).length
  const shipCount = (s: string) => pilots.filter(p => p.ship === s).length

  const add = (id: string) => {
    const pilot: XwingPilot = { name: id, ship: xwaPilots[id].ship, points: xwaPilots[id].points }
    if (swapIndex !== null) {
      setPilots(pilots.map((p, i) => (i === swapIndex ? pilot : p)))
      setSwapIndex(null)
      return
    }
    const last = pilots.map(p => p.name).lastIndexOf(id)
    setPilots(last === -1 ? [...pilots, pilot] : [...pilots.slice(0, last + 1), pilot, ...pilots.slice(last + 1)])
  }
  const removeAt = (index: number) => {
    setPilots(pilots.filter((_, i) => i !== index))
    setSwapIndex(null)
  }
  const removeOne = (id: string) => removeAt(pilots.map(p => p.name).lastIndexOf(id))
  const startSwap = (index: number) => {
    setSwapIndex(index)
    setShip(pilots[index].ship)
    setSearch('')
  }
  const chooseShip = (s: string) => { setShip(s); setSearch(''); setShipSheet(false) }

  const back = () => {
    if (!editing && pilots.length === 0) setFaction(undefined)
    else onBack()
  }

  const save = (name: string) => {
    setSaving(false)
    onSaved(saveList(name, pilots, faction))
  }

  const subtitle = editing ? `Editing ${editing.name} · ${savedTotal} pts when saved` : forWhom ? `New list · ${forWhom}` : 'New list'
  const header = (
    <Header
      onBack={back}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <h1 style={titleStyle}>{factionName(faction)}</h1>
          <span style={{ color: 'var(--color-text-body)', display: 'flex' }}><FactionIcon faction={faction} /></span>
        </div>
      }
      subtitle={subtitle}
      right={isPortrait ? undefined : <Status total={total} ships={pilots.length} message={message} ready={status.ready} />}
    />
  )

  const query = search.trim().toLowerCase()
  const shipPilots = (shownShip?.pilots ?? []).filter(id => pilotName(id).toLowerCase().includes(query))
  const pilotOptions = (
    <>
      <label style={{ ...rowStyle(), cursor: 'text', justifyContent: 'flex-start', color: 'var(--color-text-muted)' }}>
        <SearchIcon />
        <input
          aria-label={`Search ${shownShip?.name} pilots`}
          placeholder={`Search ${shownShip?.pilots.length ?? 0} pilots`}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: 'var(--color-text-primary)', fontFamily: 'inherit', fontSize: '16px', outline: 'none' }}
        />
      </label>
      {atCap && <div role="status" style={{ fontSize: '0.8rem', color: 'var(--color-warning)', padding: '4px 4px' }}>{SHIPS_MAX} ships is the most a list can have. Remove one to add another.</div>}
      {shipPilots.map(id => {
        const count = countOf(id)
        const limit = xwaPilots[id].limit
        const block = addBlock(others, id)
        const note = xwaPilots[id].unique
          ? (count > 0 ? ' · in list' : '')
          : limit !== undefined && count >= limit ? ` · ${count} of ${limit}, the limit` : count > 0 ? ` · ${count} in list` : ''
        return (
          <button key={id} type="button" data-testid={`pilot-option-${id}`} disabled={block !== null} onClick={() => add(id)} style={{ ...rowStyle(), ...(block ? disabledRow : {}) }}>
            <span>{label(id)}{note && <span style={block ? undefined : countStyle}>{note}</span>}</span>
            <span style={{ display: 'flex', gap: '10px', alignItems: 'baseline' }}>
              {swapping && <span style={subStyle}>total {total - swapping.points + xwaPilots[id].points}</span>}
              <span>{xwaPilots[id].points}</span>
            </span>
          </button>
        )
      })}
    </>
  )

  const swapLine = swapping && (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px', flexShrink: 0 }}>
      <div style={{ flex: 1, fontSize: '0.95rem' }}>Swap {pilotName(swapping.name)} for…</div>
      <Button onClick={() => setSwapIndex(null)}>Cancel</Button>
    </div>
  )

  const listPanel = (
    <div data-testid="builder-list" style={{ background: 'var(--color-surface)', borderRadius: '16px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '4px', overflowY: 'auto', minHeight: 0 }}>
      <div style={{ fontSize: '0.75rem', letterSpacing: '0.14em', color: 'var(--color-accent)', padding: '0 4px 2px' }}>YOUR LIST</div>
      {pilots.length === 0 && <div style={{ ...subStyle, padding: '4px' }}>Choose pilots to add them here.</div>}
      {listRows(pilots).map(row => {
        if (row.kind === 'single') {
          const p = pilots[row.index]
          const known = xwaPilots[p.name] !== undefined
          const content = (
            <>
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span>{label(p.name)}</span>
                <span style={{ ...subStyle, ...(row.index === swapIndex ? { color: 'var(--color-tonal-text)' } : {}) }}>{shipNames[p.ship] ?? p.ship}{row.index === swapIndex ? ' · swapping' : ''}</span>
              </span>
              <span>{p.points}</span>
            </>
          )
          return (
            <div key={`row-${row.index}`} data-testid={`list-row-${row.index}`} style={LIST_ROW}>
              {known
                ? <button type="button" aria-pressed={row.index === swapIndex} onClick={() => startSwap(row.index)} style={{ ...listItemStyle, ...(row.index === swapIndex ? { background: 'var(--color-tonal)', outline: '2px solid var(--color-accent)' } : {}) }}>{content}</button>
                : <div style={{ ...listItemStyle, cursor: 'default' }}>{content}</div>}
              <button type="button" aria-label={`Remove ${pilotName(p.name)}`} onClick={() => removeAt(row.index)} style={squareStyle()}><CloseIcon /></button>
            </div>
          )
        }
        const pilot = xwaPilots[row.id]
        const block = addBlock(pilots, row.id)
        const name = pilotName(row.id)
        const plusLabel = block === 'limit' ? `No more ${name}: limit ${pilot.limit} per list` : block === 'ships' ? `No more ${name}: ${SHIPS_MAX} ships is the most` : `One more ${name}`
        const sub = pilot.limit !== undefined ? `Limit ${pilot.limit} per list` : `${row.count} × ${pilot.points}${block === 'ships' ? ` · ${SHIPS_MAX} ships is the most` : ''}`
        return (
          <div key={`group-${row.id}`} data-testid={`list-group-${row.id}`} style={LIST_ROW}>
            <div style={{ ...listItemStyle, cursor: 'default' }}>
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span>{name}</span>
                <span style={subStyle}>{sub}</span>
              </span>
              <span>{row.count * pilot.points}</span>
            </div>
            <button type="button" aria-label={`One fewer ${name}`} onClick={() => removeOne(row.id)} style={squareStyle()}>−</button>
            <button type="button" aria-label={plusLabel} disabled={block !== null || swapIndex !== null} onClick={() => add(row.id)} style={squareStyle(block !== null)}>+</button>
          </div>
        )
      })}
    </div>
  )

  const saveButton = (
    <Button variant="primary" disabled={!status.ready} onClick={() => setSaving(true)} style={{ minHeight: isPortrait ? '56px' : '52px', flexShrink: 0 }}>
      {editing ? 'Save changes' : 'Save list'}
    </Button>
  )

  const saveSheet = (
    <XwingSaveListSheet
      open={saving}
      pilots={pilots}
      faction={faction}
      lists={lists}
      initialName={initial?.name ?? ''}
      editing={editing}
      onClose={() => setSaving(false)}
      onSave={save}
    />
  )

  if (isPortrait) {
    return (
      <AppScreenLayout>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px 16px 24px', overflowY: 'auto', color: 'var(--color-text-primary)' }}>
          {header}
          <div style={{ background: 'var(--color-surface)', borderRadius: '16px', padding: '8px 16px', flexShrink: 0 }}>
            <Status total={total} ships={pilots.length} message={message} ready={status.ready} />
          </div>
          {/* The page scrolls as a whole in portrait, so nothing in it may shrink. */}
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column' }}>{listPanel}</div>
          {swapLine}
          <div style={{ flexShrink: 0, display: 'flex' }}>
            <SelectButton label="Ship" value={shownShip?.name ?? ''} onClick={() => setShipSheet(true)} />
          </div>
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>{pilotOptions}</div>
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column' }}>{saveButton}</div>
        </div>
        <Sheet open={shipSheet} title="Ship" onClose={() => setShipSheet(false)}>
          {ships.map(s => (
            <OptionRow key={s.ship} title={s.name} detail={shipCount(s.ship) > 0 ? `${shipCount(s.ship)} in list` : undefined} selected={s.ship === shownShip?.ship} onClick={() => chooseShip(s.ship)} />
          ))}
        </Sheet>
        {saveSheet}
      </AppScreenLayout>
    )
  }

  return (
    <AppScreenLayout>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', color: 'var(--color-text-primary)' }}>
        {header}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '12px' }}>
          <div style={{ width: '188px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '4px', overflowY: 'auto' }}>
            {ships.map(s => {
              const n = shipCount(s.ship)
              const selected = s.ship === shownShip?.ship
              return (
                <button key={s.ship} type="button" aria-pressed={selected} onClick={() => chooseShip(s.ship)} style={rowStyle(selected)}>
                  <span>{s.name}</span>
                  {n > 0 && <span style={countStyle}>{selected ? `${n} in list` : n}</span>}
                </button>
              )
            })}
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px', overflowY: 'auto' }}>
            {swapLine}
            {pilotOptions}
          </div>
          <div style={{ width: '272px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{listPanel}</div>
            {saveButton}
          </div>
        </div>
      </div>
      {saveSheet}
    </AppScreenLayout>
  )
}

const titleStyle: React.CSSProperties = { margin: 0, fontSize: '1.25rem', fontWeight: 300, letterSpacing: '0.08em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

function Header({ onBack, title, subtitle, right }: { onBack: () => void; title: ReactNode; subtitle: string; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
      <IconButton label="Back" onClick={onBack}><BackIcon /></IconButton>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {title}
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{subtitle}</div>
      </div>
      {right}
    </div>
  )
}

// The running total against 50, the ship count, and what stands between the list and Save.
function Status({ total, ships, message, ready }: { total: number; ships: number; message: string; ready: boolean }) {
  return (
    <div data-testid="builder-status" role="status" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
        <span style={{ fontSize: '1.5rem', fontWeight: 300 }}>{total}</span>
        <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>/ {POINTS_MAX} pts</span>
        <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>· {ships} ships ({SHIPS_MIN}–{SHIPS_MAX})</span>
      </div>
      <div style={{ fontSize: '0.75rem', color: ready ? 'var(--color-success)' : 'var(--color-warning)' }}>{message}</div>
    </div>
  )
}

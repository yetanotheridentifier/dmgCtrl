import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import XwingListBuilder from '../components/xwingListBuilder'
import type { XwingList } from '../hooks/useXwingLists'
import { xwaPilots } from '../data/xwaCards'
import { makeMatchMediaMock } from './setup'

const p = (id: string, points = xwaPilots[id].points) => ({ name: id, ship: xwaPilots[id].ship, points })

// Saved at older costs: Howlrunner was 9, so it was 50 when saved and is 49 today.
const SWARM: XwingList = {
  id: 'swarm',
  name: 'Howlrunner swarm',
  faction: 'galacticempire',
  createdAt: '2026-01-01T00:00:00.000Z',
  pilots: [p('howlrunner', 9), p('maulermithel'), p('wampa'), p('isbjingoist'), p('isbjingoist'), p('academypilot'), p('blacksquadronace')],
}

const mockXwingLists = vi.hoisted(() => ({
  lists: [] as XwingList[],
  saveList: vi.fn(() => 'new-id'),
  renameList: vi.fn(),
  removeList: vi.fn(),
}))
vi.mock('../hooks/useXwingLists', () => ({
  useXwingLists: () => mockXwingLists,
}))

type Props = Partial<React.ComponentProps<typeof XwingListBuilder>>

function renderBuilder(props: Props = {}) {
  const onBack = vi.fn()
  const onSaved = vi.fn()
  render(<XwingListBuilder onBack={onBack} onSaved={onSaved} {...props} />)
  return { onBack, onSaved }
}

const option = (id: string) => screen.getByTestId(`pilot-option-${id}`)
const listPanel = () => screen.getByTestId('builder-list')
const status = () => screen.getByTestId('builder-status')
const saveButton = () => screen.getByRole('button', { name: /^(Save list|Save changes)$/ })

// Landscape lists the ships in a column; portrait chooses one from a sheet.
async function chooseShip(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  const select = screen.queryByRole('button', { name: /^Ship: / })
  if (select) {
    await user.click(select)
    await user.click(within(screen.getByRole('dialog', { name: 'Ship' })).getByRole('button', { name }))
  } else {
    await user.click(screen.getByRole('button', { name }))
  }
}

async function startEmpire(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Galactic Empire/ }))
  await chooseShip(user, /TIE\/ln Fighter/)
}

async function add(user: ReturnType<typeof userEvent.setup>, ...ids: string[]) {
  for (const id of ids) await user.click(option(id))
}

// 49 points, 7 TIE/ln Fighters: legal.
const LEGAL = ['howlrunner', 'maulermithel', 'wampa', 'isbjingoist', 'isbjingoist', 'academypilot', 'blacksquadronace']

beforeEach(() => {
  mockXwingLists.lists = []
  mockXwingLists.saveList.mockClear()
})

describe('XwingListBuilder', () => {

  // --- Choosing a faction ---

  it('a new list starts by choosing one of the seven factions, each with its ship count', () => {
    renderBuilder({ side: 'player' })
    expect(screen.getByText('For you · choose a faction')).toBeInTheDocument()
    const factions = screen.getAllByTestId(/^faction-/)
    expect(factions.map(f => f.dataset.testid)).toEqual([
      'faction-rebelalliance', 'faction-galacticempire', 'faction-scumandvillainy', 'faction-resistance',
      'faction-firstorder', 'faction-galacticrepublic', 'faction-separatistalliance',
    ])
    expect(screen.getByTestId('faction-galacticempire')).toHaveTextContent('18 ships')
    expect(screen.getByTestId('faction-galacticempire').querySelector('svg')).not.toBeNull()
  })

  it('Back on the faction step leaves the builder', async () => {
    const user = userEvent.setup()
    const { onBack } = renderBuilder()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('offers Import XWS on the faction step when given a way there', async () => {
    const user = userEvent.setup()
    const onImport = vi.fn()
    renderBuilder({ onImport })
    await user.click(screen.getByRole('button', { name: 'Import XWS' }))
    expect(onImport).toHaveBeenCalled()
  })

  // --- Adding pilots ---

  it("after a faction, shows its name and symbol, its ships A to Z, and a ship's pilots cheapest first with points", async () => {
    const user = userEvent.setup()
    renderBuilder({ side: 'opponent' })
    await user.click(screen.getByRole('button', { name: /Galactic Empire/ }))
    const heading = screen.getByRole('heading', { name: 'Galactic Empire' })
    expect(heading.parentElement!.querySelector('svg[aria-label="Galactic Empire"]')).not.toBeNull()
    expect(screen.getByText('New list · for your opponent')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Alpha-Class Star Wing/, pressed: true })).toBeInTheDocument()
    await chooseShip(user, /TIE\/ln Fighter/)
    expect(screen.getByRole('button', { name: /TIE\/ln Fighter/, pressed: true })).toBeInTheDocument()
    expect(option('academypilot')).toHaveTextContent('Academy Pilot')
    expect(option('academypilot')).toHaveTextContent('5')
    expect(option('howlrunner')).toHaveTextContent('• "Howlrunner"')
  })

  it('choosing another ship shows its pilots', async () => {
    const user = userEvent.setup()
    renderBuilder()
    await startEmpire(user)
    await user.click(screen.getByRole('button', { name: /TIE\/in Interceptor/ }))
    expect(option('soontirfel')).toBeInTheDocument()
    expect(screen.queryByTestId('pilot-option-howlrunner')).not.toBeInTheDocument()
  })

  it('search narrows the pilots of the chosen ship', async () => {
    const user = userEvent.setup()
    renderBuilder()
    await startEmpire(user)
    await user.type(screen.getByRole('textbox', { name: /Search TIE\/ln Fighter pilots/ }), 'howl')
    expect(option('howlrunner')).toBeInTheDocument()
    expect(screen.queryByTestId('pilot-option-academypilot')).not.toBeInTheDocument()
  })

  it('adding pilots keeps a running total against 50 and a ship count', async () => {
    const user = userEvent.setup()
    renderBuilder()
    await startEmpire(user)
    await add(user, 'howlrunner', 'academypilot')
    expect(status()).toHaveTextContent('13/ 50 pts· 2 ships (3–8)')
    expect(status()).toHaveTextContent('Add at least 3 ships')
    expect(within(listPanel()).getByText('• "Howlrunner"')).toBeInTheDocument()
  })

  it('a unique pilot in the list is greyed out and cannot be added again', async () => {
    const user = userEvent.setup()
    renderBuilder()
    await startEmpire(user)
    await add(user, 'howlrunner')
    expect(option('howlrunner')).toBeDisabled()
    expect(option('howlrunner')).toHaveTextContent('in list')
  })

  it('repeats of a generic pilot share one row with − and +, and its option counts them', async () => {
    const user = userEvent.setup()
    renderBuilder()
    await startEmpire(user)
    await add(user, 'academypilot', 'academypilot')
    const row = screen.getByTestId('list-group-academypilot')
    expect(row).toHaveTextContent('2 × 5')
    expect(row).toHaveTextContent('10')
    expect(option('academypilot')).toHaveTextContent('2 in list')
    await user.click(within(row).getByRole('button', { name: 'One more Academy Pilot' }))
    expect(row).toHaveTextContent('3 × 5')
    await user.click(within(row).getByRole('button', { name: 'One fewer Academy Pilot' }))
    await user.click(within(row).getByRole('button', { name: 'One fewer Academy Pilot' }))
    await user.click(within(row).getByRole('button', { name: 'One fewer Academy Pilot' }))
    expect(screen.queryByTestId('list-group-academypilot')).not.toBeInTheDocument()
  })

  it('a generic pilot at its per-squad limit shows the limit and its + is disabled', async () => {
    const user = userEvent.setup()
    renderBuilder()
    await startEmpire(user)
    await add(user, 'isbjingoist', 'isbjingoist')
    expect(option('isbjingoist')).toBeDisabled()
    expect(option('isbjingoist')).toHaveTextContent('2 of 2, the limit')
    const row = screen.getByTestId('list-group-isbjingoist')
    expect(row).toHaveTextContent('Limit 2 per list')
    expect(within(row).getByRole('button', { name: 'No more ISB Jingoist: limit 2 per list' })).toBeDisabled()
  })

  it('at 8 ships every pilot is disabled and the reason is shown', async () => {
    const user = userEvent.setup()
    renderBuilder()
    await startEmpire(user)
    await add(user, ...Array(8).fill('academypilot'))
    expect(screen.getByText('8 ships is the most a list can have. Remove one to add another.')).toBeInTheDocument()
    expect(option('blacksquadronace')).toBeDisabled()
    expect(within(screen.getByTestId('list-group-academypilot')).getByRole('button', { name: 'No more Academy Pilot: 8 ships is the most' })).toBeDisabled()
  })

  it('a unique pilot is removed with its ✕', async () => {
    const user = userEvent.setup()
    renderBuilder()
    await startEmpire(user)
    await add(user, 'howlrunner')
    await user.click(screen.getByRole('button', { name: 'Remove "Howlrunner"' }))
    expect(within(listPanel()).queryByText('• "Howlrunner"')).not.toBeInTheDocument()
    expect(option('howlrunner')).toBeEnabled()
  })

  it('tapping a pilot in the list swaps it for the next pilot chosen, in its place', async () => {
    const user = userEvent.setup()
    renderBuilder()
    await startEmpire(user)
    await add(user, 'howlrunner', 'maulermithel')
    await user.click(within(listPanel()).getByRole('button', { name: /^• "Howlrunner"/ }))
    expect(screen.getByText('Swap "Howlrunner" for…')).toBeInTheDocument()
    expect(option('wampa')).toHaveTextContent('total 14')
    await user.click(option('wampa'))
    const names = within(listPanel()).getAllByTestId(/^list-(row|group)-/).map(r => r.textContent)
    expect(names[0]).toContain('"Wampa"')
    expect(names[1]).toContain('"Mauler" Mithel')
    expect(screen.queryByText(/Swap .* for…/)).not.toBeInTheDocument()
  })

  it('Cancel stops a swap without changing the list', async () => {
    const user = userEvent.setup()
    renderBuilder()
    await startEmpire(user)
    await add(user, 'howlrunner')
    await user.click(within(listPanel()).getByRole('button', { name: /^• "Howlrunner"/ }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/Swap .* for…/)).not.toBeInTheDocument()
    expect(within(listPanel()).getByText('• "Howlrunner"')).toBeInTheDocument()
  })

  it('Back with no pilots added returns to the faction step', async () => {
    const user = userEvent.setup()
    const { onBack } = renderBuilder()
    await startEmpire(user)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('faction-galacticempire')).toBeInTheDocument()
    expect(onBack).not.toHaveBeenCalled()
  })

  // --- Saving ---

  it('Save list stays disabled, with the reason, until the list is legal', async () => {
    const user = userEvent.setup()
    renderBuilder()
    await startEmpire(user)
    await add(user, 'howlrunner', 'maulermithel', 'wampa', 'isbjingoist', 'isbjingoist', 'academypilot')
    expect(status()).toHaveTextContent('3 more points to save (46–50)')
    expect(saveButton()).toBeDisabled()
    await add(user, 'blacksquadronace')
    expect(status()).toHaveTextContent('Ready to save')
    expect(saveButton()).toBeEnabled()
  })

  it('saving with the name left blank uses the faction default, and hands back the new id', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [{ ...SWARM, id: 'other', name: 'Galactic Empire list 1' }]
    const { onSaved } = renderBuilder()
    await startEmpire(user)
    await add(user, ...LEGAL)
    await user.click(saveButton())
    const sheet = screen.getByRole('dialog', { name: 'Save list' })
    expect(within(sheet).getByText('49 pts · 7 ships · Galactic Empire')).toBeInTheDocument()
    expect(within(sheet).getByRole('textbox', { name: 'Name' })).toHaveAttribute('placeholder', 'Galactic Empire list 2')
    expect(within(sheet).getByText(/Left blank, it's saved as/)).toHaveTextContent('Galactic Empire list 2')
    await user.click(within(sheet).getByRole('button', { name: 'Save list' }))
    expect(mockXwingLists.saveList).toHaveBeenCalledWith(
      'Galactic Empire list 2',
      LEGAL.map(id => p(id)),
      'galacticempire',
    )
    expect(onSaved).toHaveBeenCalledWith('new-id')
  })

  it('a name another list uses turns Save into Overwrite, naming the list it replaces', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SWARM]
    renderBuilder()
    await startEmpire(user)
    await add(user, ...LEGAL)
    await user.click(saveButton())
    const sheet = screen.getByRole('dialog', { name: 'Save list' })
    await user.type(within(sheet).getByRole('textbox', { name: 'Name' }), '  Howlrunner swarm ')
    expect(within(sheet).getByText('Replaces your saved Howlrunner swarm')).toBeInTheDocument()
    expect(within(sheet).getByText('50 pts · Galactic Empire. Change the name to keep both.')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Overwrite Howlrunner swarm' }))
    expect(mockXwingLists.saveList).toHaveBeenCalledWith('Howlrunner swarm', expect.any(Array), 'galacticempire')
  })

  // --- Editing ---

  it('edit opens the saved list at today\'s costs, with what it was when saved', () => {
    renderBuilder({ editing: SWARM })
    expect(screen.getByRole('heading', { name: 'Galactic Empire' })).toBeInTheDocument()
    expect(screen.getByText('Editing Howlrunner swarm · 50 pts when saved')).toBeInTheDocument()
    expect(status()).toHaveTextContent('49/ 50 pts· 7 ships (3–8)')
    expect(within(listPanel()).getByText('• "Howlrunner"')).toBeInTheDocument()
    expect(saveButton()).toHaveTextContent('Save changes')
  })

  it('an edited list over 50 at today\'s costs says the costs have changed', () => {
    renderBuilder({ editing: { ...SWARM, pilots: [...SWARM.pilots.slice(0, 6), p('blacksquadronace', 3), p('obsidiansquadronpilot')] } })
    expect(status()).toHaveTextContent('4 points over (46–50): costs have changed')
  })

  it('Back while editing leaves the builder', async () => {
    const user = userEvent.setup()
    const { onBack } = renderBuilder({ editing: SWARM })
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('save changes is pre-filled with the name and updates the list in place', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SWARM]
    mockXwingLists.saveList.mockReturnValueOnce('swarm')
    const { onSaved } = renderBuilder({ editing: SWARM })
    await user.click(screen.getByRole('button', { name: 'Remove "Wampa"' }))
    await user.click(option('blacksquadronace'))
    await user.click(saveButton())
    const sheet = screen.getByRole('dialog', { name: 'Save changes' })
    expect(within(sheet).getByRole('textbox', { name: 'Name' })).toHaveValue('Howlrunner swarm')
    expect(within(sheet).getByText('Updates Howlrunner swarm')).toBeInTheDocument()
    expect(within(sheet).getByText('Was 50 pts. Change the name to save a copy instead.')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Save changes' }))
    expect(mockXwingLists.saveList).toHaveBeenCalledWith('Howlrunner swarm', expect.any(Array), 'galacticempire')
    expect(onSaved).toHaveBeenCalledWith('swarm')
  })

  it('the faction of an older list saved without one comes from its pilots', () => {
    renderBuilder({ editing: { ...SWARM, faction: undefined } })
    expect(screen.getByRole('heading', { name: 'Galactic Empire' })).toBeInTheDocument()
  })

  // --- Portrait ---

  it('portrait: the ship is chosen from a sheet', async () => {
    makeMatchMediaMock(true)
    const user = userEvent.setup()
    renderBuilder()
    await startEmpire(user)
    expect(screen.getByRole('button', { name: /^Ship: TIE\/ln Fighter/ })).toBeInTheDocument()
    await chooseShip(user, /TIE\/in Interceptor/)
    expect(option('soontirfel')).toBeInTheDocument()
  })
})

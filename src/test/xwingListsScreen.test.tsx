import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import XwingListsScreen from '../components/xwingListsScreen'
import type { XwingList } from '../hooks/useXwingLists'

const VALID_XWS = JSON.stringify({
  name: 'Scum Syndicate',
  faction: 'scumandvillainy',
  pilots: [
    { name: 'asajjventress', ship: 'lancerclasspursuitcraft', points: 15 },
    { name: 'bobafett-armedanddangerous', ship: 'firesprayclasspatrolcraft', points: 18 },
    { name: 'bossk', ship: 'yv666lightfreighter', points: 17 },
  ],
  points: 50,
})

// Wedge 14, Luke 14, Dash Rendar 19: 47 points.
const UNNAMED_XWS = JSON.stringify({
  pilots: [
    { name: 'wedgeantilles', ship: 't65xwing', points: 14 },
    { name: 'lukeskywalker', ship: 't65xwing', points: 14 },
    { name: 'dashrendar', ship: 'yt2400lightfreighter', points: 19 },
  ],
  points: 47,
})

// The design's example: a misspelt Biggs, and 57 points at today's costs (the file says 50).
const REBEL_BEEF_XWS = JSON.stringify({
  name: 'Rebel beef',
  faction: 'rebelalliance',
  pilots: [
    { name: 'wedgeantilles', ship: 't65xwing', points: 12 },
    { name: 'lukeskywalker', ship: 't65xwing', points: 12 },
    { name: 'bigsdarklighter', ship: 't65xwing', points: 10 },
    { name: 'dashrendar', ship: 'yt2400lightfreighter', points: 16 },
  ],
  points: 50,
})

// Saved at older costs: 46 in the file, 50 today (Asajj 15, Boba 18, Bossk 17).
const STALE_XWS = JSON.stringify({
  name: 'Old scum',
  faction: 'scumandvillainy',
  pilots: [
    { name: 'asajjventress', ship: 'lancerclasspursuitcraft', points: 14 },
    { name: 'bobafett-armedanddangerous', ship: 'firesprayclasspatrolcraft', points: 16 },
    { name: 'bossk', ship: 'yv666lightfreighter', points: 16 },
  ],
  points: 46,
})

// Two of the same unique pilot: the shape is fine, the list is not.
const DUPLICATE_XWS = JSON.stringify({
  name: 'Two Howlrunners',
  faction: 'galacticempire',
  pilots: [
    { name: 'howlrunner', ship: 'tielnfighter', points: 8 },
    { name: 'howlrunner', ship: 'tielnfighter', points: 8 },
    { name: 'soontirfel', ship: 'tieininterceptor', points: 13 },
    { name: 'soontirfel', ship: 'tieininterceptor', points: 13 },
    { name: 'academypilot', ship: 'tielnfighter', points: 5 },
  ],
  points: 47,
})

const SCUM: XwingList = {
  id: 'l1',
  name: 'Scum Syndicate',
  faction: 'scumandvillainy',
  pilots: [
    { name: 'asajjventress', ship: 'lancerclasspursuitcraft', points: 15 },
    { name: 'bossk', ship: 'yv666lightfreighter', points: 17 },
    { name: 'nashtahpup', ship: 'z95af4headhunter', points: 0 },
  ],
}

const EMPIRE: XwingList = {
  id: 'l2',
  name: 'Vader Wing',
  pilots: [
    { name: 'darthvader', ship: 'tieadvancedx1', points: 21 },
    { name: 'soontirfel', ship: 'tieininterceptor', points: 15 },
    { name: 'vermeil', ship: 'tiedefender', points: 14 },
  ],
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

type Props = Partial<React.ComponentProps<typeof XwingListsScreen>>

function renderScreen(overrides: Props = {}) {
  return render(<XwingListsScreen onBack={vi.fn()} onHelp={vi.fn()} {...overrides} />)
}

async function openImport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Import XWS' }))
}

async function pasteAndCheck(user: ReturnType<typeof userEvent.setup>, text: string) {
  fireEvent.change(screen.getByTestId('lists-textarea'), { target: { value: text } })
  await user.click(screen.getByRole('button', { name: 'Check' }))
}

beforeEach(() => {
  mockXwingLists.lists = []
  mockXwingLists.saveList.mockClear()
  mockXwingLists.renameList.mockClear()
  mockXwingLists.removeList.mockClear()
})

describe('XwingListsScreen', () => {

  // --- Header ---

  it('shows a Squad Lists heading', () => {
    renderScreen()
    expect(screen.getByRole('heading', { name: 'Squad Lists' })).toBeInTheDocument()
  })

  it('back button calls onBack', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    renderScreen({ onBack })
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('help button calls onHelp', async () => {
    const user = userEvent.setup()
    const onHelp = vi.fn()
    renderScreen({ onHelp })
    await user.click(screen.getByRole('button', { name: 'Help' }))
    expect(onHelp).toHaveBeenCalled()
  })

  // --- Saved lists ---

  it('shows an empty state when there are no saved lists', () => {
    renderScreen()
    expect(screen.getByTestId('xwing-lists-empty')).toHaveTextContent('No saved lists')
  })

  it('shows each saved list with its faction symbol, points, ships, faction and pilots', () => {
    mockXwingLists.lists = [SCUM, EMPIRE]
    renderScreen()
    const scum = screen.getByTestId('list-row-l1')
    expect(scum).toHaveTextContent('Scum Syndicate')
    expect(scum.querySelector('svg[aria-label="Scum and Villainy"]')).not.toBeNull()
    expect(screen.getByTestId('list-meta-l1')).toHaveTextContent('32 pts · 3 ships · Scum and Villainy')
    expect(scum).toHaveTextContent('Asajj Ventress, Bossk')
    expect(screen.getByTestId('list-meta-l2')).toHaveTextContent(/^50 pts · 3 ships$/)
  })

  // --- Rename ---

  it('rename opens an input holding the current name', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM]
    renderScreen()
    await user.click(screen.getByTestId('list-rename-btn-l1'))
    expect(screen.getByTestId('list-rename-input-l1')).toHaveValue('Scum Syndicate')
  })

  it('saving a rename calls renameList with the new name and closes the input', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM]
    renderScreen()
    await user.click(screen.getByTestId('list-rename-btn-l1'))
    await user.clear(screen.getByTestId('list-rename-input-l1'))
    await user.type(screen.getByTestId('list-rename-input-l1'), 'Bounty Hunters')
    await user.click(screen.getByTestId('list-rename-save-l1'))
    expect(mockXwingLists.renameList).toHaveBeenCalledWith('l1', 'Bounty Hunters')
    expect(screen.queryByTestId('list-rename-input-l1')).not.toBeInTheDocument()
  })

  it('a rename to a name another list uses shows an error and is not saved', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM, EMPIRE]
    renderScreen()
    await user.click(screen.getByTestId('list-rename-btn-l1'))
    await user.clear(screen.getByTestId('list-rename-input-l1'))
    await user.type(screen.getByTestId('list-rename-input-l1'), 'Vader Wing')
    await user.click(screen.getByTestId('list-rename-save-l1'))
    expect(mockXwingLists.renameList).not.toHaveBeenCalled()
    expect(screen.getByTestId('list-rename-error-l1')).toHaveTextContent('Another list already has that name.')
  })

  it('rename save is disabled when the name is blank', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM]
    renderScreen()
    await user.click(screen.getByTestId('list-rename-btn-l1'))
    await user.clear(screen.getByTestId('list-rename-input-l1'))
    expect(screen.getByTestId('list-rename-save-l1')).toBeDisabled()
  })

  it('cancelling a rename closes the input without saving', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM]
    renderScreen()
    await user.click(screen.getByTestId('list-rename-btn-l1'))
    await user.click(screen.getByTestId('list-rename-cancel-l1'))
    expect(mockXwingLists.renameList).not.toHaveBeenCalled()
    expect(screen.queryByTestId('list-rename-input-l1')).not.toBeInTheDocument()
  })

  // --- Delete ---

  it('delete asks for confirmation, naming the list, before removing', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM]
    renderScreen()
    await user.click(screen.getByTestId('list-delete-btn-l1'))
    expect(mockXwingLists.removeList).not.toHaveBeenCalled()
    const confirm = screen.getByRole('alertdialog', { name: 'Delete Scum Syndicate?' })
    expect(confirm).toHaveTextContent("32 pts · 3 ships · Scum and Villainy. This can't be undone.")
    await user.click(screen.getByTestId('list-delete-confirm-l1'))
    expect(mockXwingLists.removeList).toHaveBeenCalledWith('l1')
  })

  it('cancelling a delete keeps the list', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM]
    renderScreen()
    await user.click(screen.getByTestId('list-delete-btn-l1'))
    await user.click(screen.getByTestId('list-delete-cancel-l1'))
    expect(mockXwingLists.removeList).not.toHaveBeenCalled()
    expect(screen.getByTestId('list-delete-btn-l1')).toBeInTheDocument()
  })

  // --- Builder ---

  it('New list opens the builder at the faction step, and Back returns to the lists', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM]
    renderScreen()
    await user.click(screen.getByRole('button', { name: 'New list' }))
    expect(screen.getByTestId('faction-galacticempire')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'Squad Lists' })).toBeInTheDocument()
  })

  it('Edit opens the builder on that list', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM]
    renderScreen()
    await user.click(screen.getByTestId('list-edit-btn-l1'))
    expect(screen.getByRole('heading', { name: 'Scum and Villainy' })).toBeInTheDocument()
    expect(screen.getByText(/^Editing Scum Syndicate/)).toBeInTheDocument()
  })

  // --- Import XWS ---

  it('Import XWS opens the paste box', async () => {
    const user = userEvent.setup()
    renderScreen()
    await openImport(user)
    expect(screen.getByRole('heading', { name: 'Import XWS' })).toBeInTheDocument()
    expect(screen.getByTestId('lists-textarea')).toBeInTheDocument()
  })

  it('opened straight to the paste box, Back leaves the screen', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    renderScreen({ startWith: 'import', onBack })
    expect(screen.getByTestId('lists-textarea')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('opened from the lists, Back from the paste box returns to the lists', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    renderScreen({ onBack })
    await openImport(user)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'Squad Lists' })).toBeInTheDocument()
    expect(onBack).not.toHaveBeenCalled()
  })

  it('an unreadable paste shows an error and cannot be saved', async () => {
    const user = userEvent.setup()
    renderScreen()
    await openImport(user)
    await pasteAndCheck(user, 'not json')
    expect(screen.getByTestId('lists-error')).toHaveTextContent("Couldn't read list")
    expect(screen.getByRole('button', { name: 'Save list' })).toBeDisabled()
  })

  it('a list with a unique pilot twice lists the problem and cannot be saved', async () => {
    const user = userEvent.setup()
    renderScreen()
    await openImport(user)
    await pasteAndCheck(user, DUPLICATE_XWS)
    const result = screen.getByRole('alert')
    expect(result).toHaveTextContent("Two Howlrunners can't be saved yet")
    expect(result).toHaveTextContent('2 problems')
    expect(result).toHaveTextContent('"Howlrunner" is unique: only one per list.')
    expect(result).toHaveTextContent('Soontir Fel is unique: only one per list.')
    expect(screen.getByRole('button', { name: 'Save list' })).toBeDisabled()
  })

  it('names a pilot it does not know with a suggestion, and totals the list at today\'s costs', async () => {
    const user = userEvent.setup()
    renderScreen()
    await openImport(user)
    await pasteAndCheck(user, REBEL_BEEF_XWS)
    const result = screen.getByRole('alert')
    expect(result).toHaveTextContent("Rebel beef can't be saved yet")
    expect(result).toHaveTextContent('2 problems')
    expect(result).toHaveTextContent('Ship 3: no pilot called bigsdarklighter. Did you mean Biggs Darklighter?')
    expect(result).toHaveTextContent("57 pts at today's costs: lists are 46–50.")
    expect(screen.getByRole('button', { name: 'Save list' })).toBeDisabled()
  })

  it('a list that is legal at today\'s costs saves at today\'s costs', async () => {
    const user = userEvent.setup()
    renderScreen()
    await openImport(user)
    await pasteAndCheck(user, STALE_XWS)
    expect(screen.getByTestId('lists-new-meta')).toHaveTextContent('50 pts · 3 ships · Scum and Villainy')
    await user.click(screen.getByRole('button', { name: 'Save list' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Save list' })).getByRole('button', { name: 'Save list' }))
    expect(mockXwingLists.saveList).toHaveBeenCalledWith('Old scum', [
      { name: 'asajjventress', ship: 'lancerclasspursuitcraft', points: 15 },
      { name: 'bobafett-armedanddangerous', ship: 'firesprayclasspatrolcraft', points: 18 },
      { name: 'bossk', ship: 'yv666lightfreighter', points: 17 },
    ], 'scumandvillainy')
  })

  it('a list too short to judge is still read, and its ship count is a problem', async () => {
    const user = userEvent.setup()
    renderScreen()
    await openImport(user)
    await pasteAndCheck(user, JSON.stringify({ pilots: [{ name: 'wedgeantilles', ship: 't65xwing', points: 14 }], points: 14 }))
    expect(screen.getByRole('alert')).toHaveTextContent('3 to 8 ships: this list has 1.')
    expect(screen.getByRole('button', { name: 'Fix in builder' })).toBeInTheDocument()
  })

  it('Fix in builder is offered only for a list that read but cannot be saved', async () => {
    const user = userEvent.setup()
    renderScreen()
    await openImport(user)
    expect(screen.queryByRole('button', { name: 'Fix in builder' })).not.toBeInTheDocument()
    await pasteAndCheck(user, 'not json')
    expect(screen.queryByRole('button', { name: 'Fix in builder' })).not.toBeInTheDocument()
    await pasteAndCheck(user, VALID_XWS)
    expect(screen.queryByRole('button', { name: 'Fix in builder' })).not.toBeInTheDocument()
  })

  it('Fix in builder opens a new list on the known pilots and faction, and Back returns to the paste', async () => {
    const user = userEvent.setup()
    renderScreen()
    await openImport(user)
    await pasteAndCheck(user, REBEL_BEEF_XWS)
    await user.click(screen.getByRole('button', { name: 'Fix in builder' }))
    expect(screen.getByRole('heading', { name: 'Rebel Alliance' })).toBeInTheDocument()
    expect(screen.getByText('New list')).toBeInTheDocument()
    const list = screen.getByTestId('builder-list')
    expect(within(list).getByText('• Wedge Antilles')).toBeInTheDocument()
    expect(within(list).getByText('• Dash Rendar')).toBeInTheDocument()
    expect(within(list).queryByText(/bigsdarklighter/)).not.toBeInTheDocument()
    expect(screen.getByTestId('builder-status')).toHaveTextContent('47/ 50 pts· 3 ships (3–8)')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('lists-textarea')).toHaveValue(REBEL_BEEF_XWS)
    expect(screen.getByRole('alert')).toHaveTextContent('2 problems')
  })

  it('a list fixed in the builder saves under the imported name and returns to the lists', async () => {
    const user = userEvent.setup()
    renderScreen()
    await openImport(user)
    await pasteAndCheck(user, REBEL_BEEF_XWS)
    await user.click(screen.getByRole('button', { name: 'Fix in builder' }))
    await user.click(screen.getByRole('button', { name: 'Save list' }))
    const sheet = screen.getByRole('dialog', { name: 'Save list' })
    expect(within(sheet).getByRole('textbox', { name: 'Name' })).toHaveValue('Rebel beef')
    await user.click(within(sheet).getByRole('button', { name: 'Save list' }))
    expect(mockXwingLists.saveList).toHaveBeenCalledWith('Rebel beef', expect.any(Array), 'rebelalliance')
    expect(screen.getByRole('heading', { name: 'Squad Lists' })).toBeInTheDocument()
  })

  it('a valid paste shows the pilots and points, and Clear empties the box', async () => {
    const user = userEvent.setup()
    renderScreen()
    await openImport(user)
    await pasteAndCheck(user, VALID_XWS)
    expect(screen.getByTestId('lists-preview')).toHaveTextContent('Asajj Ventress')
    expect(screen.getByTestId('lists-new-meta')).toHaveTextContent('50 pts · 3 ships · Scum and Villainy')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByTestId('lists-textarea')).toHaveValue('')
    expect(screen.queryByTestId('lists-preview')).not.toBeInTheDocument()
  })

  it('saving opens the save sheet with the XWS name, saves, and returns to the lists', async () => {
    const user = userEvent.setup()
    renderScreen()
    await openImport(user)
    await pasteAndCheck(user, VALID_XWS)
    await user.click(screen.getByRole('button', { name: 'Save list' }))
    const sheet = screen.getByRole('dialog', { name: 'Save list' })
    expect(within(sheet).getByRole('textbox', { name: 'Name' })).toHaveValue('Scum Syndicate')
    await user.click(within(sheet).getByRole('button', { name: 'Save list' }))
    expect(mockXwingLists.saveList).toHaveBeenCalledWith(
      'Scum Syndicate',
      expect.arrayContaining([expect.objectContaining({ name: 'asajjventress' })]),
      'scumandvillainy',
    )
    expect(screen.getByRole('heading', { name: 'Squad Lists' })).toBeInTheDocument()
  })

  it('an unnamed list with no faction saves as the lowest unused List N', async () => {
    const user = userEvent.setup()
    renderScreen()
    await openImport(user)
    await pasteAndCheck(user, UNNAMED_XWS)
    await user.click(screen.getByRole('button', { name: 'Save list' }))
    const sheet = screen.getByRole('dialog', { name: 'Save list' })
    await user.click(within(sheet).getByRole('button', { name: 'Save list' }))
    expect(mockXwingLists.saveList).toHaveBeenCalledWith('List 1', expect.any(Array), undefined)
  })

  it('saving under an existing name says which list it replaces', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM]
    renderScreen()
    await openImport(user)
    await pasteAndCheck(user, VALID_XWS)
    await user.click(screen.getByRole('button', { name: 'Save list' }))
    const sheet = screen.getByRole('dialog', { name: 'Save list' })
    expect(within(sheet).getByText('Replaces your saved Scum Syndicate')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Overwrite Scum Syndicate' }))
    expect(mockXwingLists.saveList).toHaveBeenCalledWith('Scum Syndicate', expect.any(Array), 'scumandvillainy')
  })
})

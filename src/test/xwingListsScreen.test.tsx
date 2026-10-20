import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import XwingListsScreen from '../components/xwingListsScreen'
import type { XwingList } from '../hooks/useXwingLists'
import { makeMatchMediaMock } from './setup'

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

const UNNAMED_XWS = JSON.stringify({
  pilots: [
    { name: 'pilota', ship: 'shipa', points: 16 },
    { name: 'pilotb', ship: 'shipb', points: 15 },
    { name: 'pilotc', ship: 'shipc', points: 15 },
  ],
  points: 46,
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
    { name: 'soontirfel', ship: 'tieinterceptor', points: 15 },
    { name: 'vermeil', ship: 'tiedefender', points: 14 },
  ],
}

const mockXwingLists = vi.hoisted(() => ({
  lists: [] as XwingList[],
  saveList: vi.fn(),
  renameList: vi.fn(),
  removeList: vi.fn(),
  clearLists: vi.fn(),
}))
vi.mock('../hooks/useXwingLists', () => ({
  useXwingLists: () => mockXwingLists,
}))

function renderScreen(overrides: Partial<{ onBack: () => void; onHelp: () => void }> = {}) {
  return render(<XwingListsScreen onBack={vi.fn()} onHelp={vi.fn()} {...overrides} />)
}

async function pasteAndCheck(text: string) {
  const user = userEvent.setup()
  fireEvent.change(screen.getByTestId('lists-textarea'), { target: { value: text } })
  await user.click(screen.getByTestId('lists-check-btn'))
  return user
}

beforeEach(() => {
  mockXwingLists.lists = []
  mockXwingLists.saveList.mockClear()
  mockXwingLists.renameList.mockClear()
  mockXwingLists.removeList.mockClear()
  mockXwingLists.clearLists.mockClear()
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

  it('does not show the empty state when lists exist', () => {
    mockXwingLists.lists = [SCUM]
    renderScreen()
    expect(screen.queryByTestId('xwing-lists-empty')).not.toBeInTheDocument()
  })

  it('shows each saved list by name', () => {
    mockXwingLists.lists = [SCUM, EMPIRE]
    renderScreen()
    expect(screen.getByTestId('list-toggle-l1')).toHaveTextContent('Scum Syndicate')
    expect(screen.getByTestId('list-toggle-l2')).toHaveTextContent('Vader Wing')
  })

  it('shows the points total and faction for a list', () => {
    mockXwingLists.lists = [SCUM]
    renderScreen()
    expect(screen.getByTestId('list-meta-l1')).toHaveTextContent('32 pts · Scum and Villainy')
  })

  it('shows only the points total when a list has no faction', () => {
    mockXwingLists.lists = [EMPIRE]
    renderScreen()
    expect(screen.getByTestId('list-meta-l2')).toHaveTextContent(/^50 pts$/)
  })

  it('pilots are hidden until the list is tapped', () => {
    mockXwingLists.lists = [SCUM]
    renderScreen()
    expect(screen.queryByTestId('list-pilots-l1')).not.toBeInTheDocument()
  })

  it('tapping a list shows its pilots, tapping again hides them', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM]
    renderScreen()
    await user.click(screen.getByTestId('list-toggle-l1'))
    expect(screen.getByTestId('list-pilots-l1')).toHaveTextContent('Asajj Ventress')
    await user.click(screen.getByTestId('list-toggle-l1'))
    expect(screen.queryByTestId('list-pilots-l1')).not.toBeInTheDocument()
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

  it('delete asks for confirmation before removing', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM]
    renderScreen()
    await user.click(screen.getByTestId('list-delete-btn-l1'))
    expect(mockXwingLists.removeList).not.toHaveBeenCalled()
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

  // --- Clear all ---

  it('Clear All is not shown when there are no lists', () => {
    renderScreen()
    expect(screen.queryByTestId('lists-clear-btn')).not.toBeInTheDocument()
  })

  it('Clear All asks for confirmation, then clears every list', async () => {
    const user = userEvent.setup()
    mockXwingLists.lists = [SCUM, EMPIRE]
    renderScreen()
    await user.click(screen.getByTestId('lists-clear-btn'))
    expect(mockXwingLists.clearLists).not.toHaveBeenCalled()
    await user.click(screen.getByTestId('lists-clear-confirm-btn'))
    expect(mockXwingLists.clearLists).toHaveBeenCalled()
  })

  // --- Create ---

  it('shows the paste box for a new list', () => {
    renderScreen()
    expect(screen.getByTestId('lists-textarea')).toBeInTheDocument()
  })

  it('an invalid paste shows an error and no preview', async () => {
    renderScreen()
    await pasteAndCheck('not json')
    expect(screen.getByTestId('lists-error')).toHaveTextContent("Couldn't read list")
    expect(screen.queryByTestId('lists-preview')).not.toBeInTheDocument()
  })

  it('a valid paste shows the pilot preview and points total', async () => {
    renderScreen()
    await pasteAndCheck(VALID_XWS)
    expect(screen.getByTestId('lists-preview')).toHaveTextContent('Asajj Ventress')
    expect(screen.getByTestId('lists-new-meta')).toHaveTextContent('50 pts · Scum and Villainy')
    expect(screen.queryByTestId('lists-textarea')).not.toBeInTheDocument()
  })

  it('the name field is pre-filled from the XWS name', async () => {
    renderScreen()
    await pasteAndCheck(VALID_XWS)
    expect(screen.getByTestId('lists-name-input')).toHaveValue('Scum Syndicate')
  })

  it('save is disabled until an unnamed list is given a name', async () => {
    renderScreen()
    const user = await pasteAndCheck(UNNAMED_XWS)
    expect(screen.getByTestId('lists-name-input')).toHaveValue('')
    expect(screen.getByTestId('lists-save-btn')).toBeDisabled()
    await user.type(screen.getByTestId('lists-name-input'), 'My List')
    expect(screen.getByTestId('lists-save-btn')).toBeEnabled()
  })

  it('saving calls saveList with the name, pilots and faction, then resets the form', async () => {
    renderScreen()
    const user = await pasteAndCheck(VALID_XWS)
    await user.click(screen.getByTestId('lists-save-btn'))
    expect(mockXwingLists.saveList).toHaveBeenCalledWith(
      'Scum Syndicate',
      expect.arrayContaining([expect.objectContaining({ name: 'asajjventress' })]),
      'scumandvillainy',
    )
    expect(screen.getByTestId('lists-textarea')).toHaveValue('')
  })

  it('the saved name is trimmed', async () => {
    renderScreen()
    const user = await pasteAndCheck(UNNAMED_XWS)
    await user.type(screen.getByTestId('lists-name-input'), '  My List  ')
    await user.click(screen.getByTestId('lists-save-btn'))
    expect(mockXwingLists.saveList).toHaveBeenCalledWith('My List', expect.any(Array), undefined)
  })

  it('saving under an existing name asks to overwrite first', async () => {
    mockXwingLists.lists = [SCUM]
    renderScreen()
    const user = await pasteAndCheck(VALID_XWS)
    await user.click(screen.getByTestId('lists-save-btn'))
    expect(mockXwingLists.saveList).not.toHaveBeenCalled()
    expect(screen.getByTestId('lists-overwrite')).toHaveTextContent("Overwrite 'Scum Syndicate'?")
    await user.click(screen.getByTestId('lists-overwrite-confirm-btn'))
    expect(mockXwingLists.saveList).toHaveBeenCalledWith('Scum Syndicate', expect.any(Array), 'scumandvillainy')
  })

  it('cancelling an overwrite does not save and keeps the preview', async () => {
    mockXwingLists.lists = [SCUM]
    renderScreen()
    const user = await pasteAndCheck(VALID_XWS)
    await user.click(screen.getByTestId('lists-save-btn'))
    await user.click(screen.getByTestId('lists-overwrite-cancel-btn'))
    expect(mockXwingLists.saveList).not.toHaveBeenCalled()
    expect(screen.queryByTestId('lists-overwrite')).not.toBeInTheDocument()
    expect(screen.getByTestId('lists-preview')).toBeInTheDocument()
  })

  it('edit returns to the paste box with the text kept', async () => {
    renderScreen()
    const user = await pasteAndCheck(VALID_XWS)
    await user.click(screen.getByTestId('lists-edit-btn'))
    expect(screen.getByTestId('lists-textarea')).toHaveValue(VALID_XWS)
    expect(screen.queryByTestId('lists-preview')).not.toBeInTheDocument()
  })

  // --- Layout ---

  it('landscape: saved lists and the new-list panel sit side by side', () => {
    // landscape is the default test orientation
    renderScreen()
    const row = screen.getByTestId('lists-layout')
    expect(row).toHaveStyle({ flexDirection: 'row' })
    expect(within(row).getByTestId('lists-saved-panel')).toBeInTheDocument()
    expect(within(row).getByTestId('lists-new-panel')).toBeInTheDocument()
  })

  it('portrait: the saved lists sit above the new-list panel', () => {
    makeMatchMediaMock(true)
    renderScreen()
    const row = screen.getByTestId('lists-layout')
    expect(row).toHaveStyle({ flexDirection: 'column' })
    const panels = within(row).getAllByTestId(/^lists-(new|saved)-panel$/).map(p => p.dataset.testid)
    expect(panels).toEqual(['lists-saved-panel', 'lists-new-panel'])
  })
})

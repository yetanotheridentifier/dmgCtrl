import { useState } from 'react'
import { useXwingLists } from '../hooks/useXwingLists'
import { parseXwsText } from '../utils/parseXwsText'
import type { XwingPilot } from '../utils/parseXwsText'
import XwingListsScreenView from './xwingListsScreenView'

interface Props {
  onBack: () => void
  onHelp: () => void
}

interface ParsedList {
  pilots: XwingPilot[]
  faction: string | undefined
}

export default function XwingListsScreen({ onBack, onHelp }: Props) {
  const { lists, saveList, renameList, removeList, clearLists } = useXwingLists()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedList | null>(null)
  const [name, setName] = useState('')

  const handleCheck = () => {
    const result = parseXwsText(text)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    setParsed({ pilots: result.pilots, faction: result.faction })
    setName(result.name ?? '')
  }

  const handleEdit = () => {
    setParsed(null)
  }

  // The view has already confirmed any overwrite by the time this is called.
  const handleSave = () => {
    if (!parsed) return
    saveList(name.trim(), parsed.pilots, parsed.faction)
    setText('')
    setName('')
    setParsed(null)
  }

  return (
    <XwingListsScreenView
      lists={lists}
      onRename={renameList}
      onDelete={removeList}
      onClear={clearLists}
      text={text}
      onTextChange={setText}
      error={error}
      onCheck={handleCheck}
      parsedPilots={parsed?.pilots ?? null}
      parsedFaction={parsed?.faction}
      onEdit={handleEdit}
      name={name}
      onNameChange={setName}
      onSave={handleSave}
      onBack={onBack}
      onHelp={onHelp}
    />
  )
}

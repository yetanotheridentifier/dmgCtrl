import { useUserSettings } from '../hooks/useUserSettings'
import AppScreenLayout from './layout/AppScreenLayout'
import SwuSettingsScreenView from './swuSettingsScreenView'

interface Props {
  onBack: () => void
  onHelp: () => void
}

function SwuSettingsScreen({ onBack, onHelp }: Props) {
  const {
    useHyperspace,
    enableForceToken,
    enableEpicActions,
    enableWakeLock,
    setUseHyperspace,
    setEnableForceToken,
    setEnableEpicActions,
    setEnableWakeLock,
  } = useUserSettings()

  return (
    <AppScreenLayout>
      <SwuSettingsScreenView
        useHyperspace={useHyperspace}
        enableForceToken={enableForceToken}
        enableEpicActions={enableEpicActions}
        enableWakeLock={enableWakeLock}
        onUseHyperspaceChange={setUseHyperspace}
        onEnableForceTokenChange={setEnableForceToken}
        onEnableEpicActionsChange={setEnableEpicActions}
        onEnableWakeLockChange={setEnableWakeLock}
        onBack={onBack}
        onHelp={onHelp}
      />
    </AppScreenLayout>
  )
}

export default SwuSettingsScreen
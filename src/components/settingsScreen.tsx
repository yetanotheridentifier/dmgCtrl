import { useUserSettings } from '../hooks/useUserSettings'
import AppScreenLayout from './layout/appScreenLayout'
import SettingsScreenView from './settingsScreenView'
import { onSettingChanged } from '../services/analytics'

interface Props {
  onBack: () => void
  onManageXwingLists?: () => void
}

function SettingsScreen({ onBack, onManageXwingLists }: Props) {
  const settings = useUserSettings()

  // Every choice is reported by its stored key; the Melee player ID is personal, so it is not.
  const reported = <T,>(name: string, setter: (v: T) => void) => (v: T) => {
    setter(v)
    void onSettingChanged(name, v)
  }

  return (
    <AppScreenLayout>
      <SettingsScreenView
        startScreen={settings.startScreen}
        onStartScreenChange={reported('startScreen', settings.setStartScreen)}
        useHyperspace={settings.useHyperspace}
        onUseHyperspaceChange={reported('useHyperspace', settings.setUseHyperspace)}
        forceTokenDisplay={settings.forceTokenDisplay}
        onForceTokenDisplayChange={reported('forceTokenDisplay', settings.setForceTokenDisplay)}
        meleePlayerGuid={settings.meleePlayerGuid}
        onMeleePlayerGuidChange={settings.setMeleePlayerGuid}
        enableDamageButtons={settings.enableDamageButtons}
        onEnableDamageButtonsChange={reported('enableDamageButtons', settings.setEnableDamageButtons)}
        enableInitiativeBar={settings.enableInitiativeBar}
        onEnableInitiativeBarChange={reported('enableInitiativeBar', settings.setEnableInitiativeBar)}
        enableXwingPhases={settings.enableXwingPhases}
        onEnableXwingPhasesChange={reported('enableXwingPhases', settings.setEnableXwingPhases)}
        enableXwingAlwaysIncDec={settings.enableXwingAlwaysIncDec}
        onEnableXwingAlwaysIncDecChange={reported('enableXwingAlwaysIncDec', settings.setEnableXwingAlwaysIncDec)}
        onManageXwingLists={onManageXwingLists}
        onBack={onBack}
      />
    </AppScreenLayout>
  )
}

export default SettingsScreen

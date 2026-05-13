export type SetType =
  | 'standard'               // Regular sets; rotation field controls Premier eligibility
  | 'premier-legal-special'  // IBH: always Premier-legal, excluded from Sealed/Draft/Chaos
  | 'eternal-only'           // TS sets: valid only in Eternal

export interface SetInfo {
  rotation: string | null  // Rotation label ('A', 'B', …) or null if not in any rotation
  type: SetType
}

// Ground truth for all format filtering logic.
// Add new sets here; no logic changes required for standard additions.
export const SET_REGISTRY: Record<string, SetInfo> = {
  SOR:  { rotation: null, type: 'standard' },
  SHD:  { rotation: null, type: 'standard' },
  TWI:  { rotation: null, type: 'standard' },
  JTL:  { rotation: 'A',  type: 'standard' },
  LOF:  { rotation: 'A',  type: 'standard' },
  SEC:  { rotation: 'A',  type: 'standard' },
  LAW:  { rotation: 'B',  type: 'standard' },
  IBH:  { rotation: null, type: 'premier-legal-special' },
  TS26: { rotation: null, type: 'eternal-only' },
}

/**
 * CarIncidentScreen — Iron Eagle Security Android Auto Surface
 *
 * Renders the active-incident list on an Android Auto head unit using
 * react-native-android-auto's template API.  The screen is mounted by
 * IronEagleCarService (declared in AndroidManifest.xml) and fed live
 * incident data by CarSocketListener.
 *
 * Prerequisites (in order):
 *  1. Run `cd mobile-app && npx expo prebuild --platform android --clean`
 *  2. Apply patches from `mobile-app/android-patches/` to the generated tree
 *  3. Ensure `react-native-android-auto` is linked (auto-linked after prebuild)
 *
 * Docs: https://github.com/birkir/react-native-android-auto
 */

import AndroidAuto, {
  CarScreen,
  type CarContext,
} from 'react-native-android-auto'

// Incident data pushed in by CarSocketListener via a simple module-level store
export interface CarIncident {
  id: string
  location: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  description: string
  timestamp: string
}

let _liveIncidents: CarIncident[] = []
let _screenRef: CarIncidentScreen | null = null

/** Called by CarSocketListener when Supabase Realtime emits a new incident. */
export function pushIncidentToCarScreen(incident: CarIncident): void {
  _liveIncidents = [incident, ..._liveIncidents].slice(0, 10) // keep last 10
  _screenRef?.invalidate()
}

/** Clear the live incident list (e.g., on sign-out). */
export function clearCarIncidents(): void {
  _liveIncidents = []
  _screenRef?.invalidate()
}

class CarIncidentScreen extends CarScreen {
  constructor(carContext: CarContext) {
    super(carContext)
    _screenRef = this
  }

  onDestroy(): void {
    if (_screenRef === this) _screenRef = null
  }

  onGetTemplate() {
    const items = _liveIncidents.length
      ? _liveIncidents.map((inc) => ({
          title: `[${inc.severity}] ${inc.location}`,
          text: inc.description.slice(0, 100),
          onPress: () => {
            // Navigate to detail screen (future extension point)
          },
        }))
      : [{ title: 'No active incidents', text: 'All zones clear' }]

    return {
      type: 'list-template',
      title: 'Iron Eagle — Active Incidents',
      headerAction: { type: 'back' },
      sections: [
        {
          header: 'Live Feed',
          items,
        },
      ],
    }
  }
}

/** Register the car app entry point with Android Auto. */
export function registerCarApp(): void {
  AndroidAuto.registerCarApp((carContext: CarContext) => {
    return new CarIncidentScreen(carContext)
  })
}

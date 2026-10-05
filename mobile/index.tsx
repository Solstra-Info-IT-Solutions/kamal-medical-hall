import '@expo/metro-runtime'; // Necessary for Fast Refresh on Web
import { registerRootComponent } from 'expo';

import { App } from './src/App';
import { initMonitoring, withMonitoring } from './src/monitoring';

initMonitoring(); // before anything else runs, so early crashes are caught

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(withMonitoring(App));

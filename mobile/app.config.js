const fs = require('fs');
const path = require('path');

/**
 * Extends app.json. Firebase native config is added only when the Firebase config files exist,
 * so the project still builds (in dev-auth mode) before the Firebase project files are added.
 * Put google-services.json and GoogleService-Info.plist in this folder (see README).
 */
module.exports = ({ config }) => {
  const android = path.join(__dirname, 'google-services.json');
  const ios = path.join(__dirname, 'GoogleService-Info.plist');
  const hasAndroid = fs.existsSync(android);
  const hasIos = fs.existsSync(ios);
  const plugins = [...(config.plugins ?? [])];
  if (hasAndroid || hasIos) {
    plugins.push('@react-native-firebase/app', '@react-native-firebase/auth', '@react-native-firebase/messaging');
    plugins.push(['expo-build-properties', { ios: { useFrameworks: 'static' } }]);
  }
  return {
    ...config,
    plugins,
    ios: { ...config.ios, ...(hasIos ? { googleServicesFile: './GoogleService-Info.plist' } : {}) },
    android: { ...config.android, ...(hasAndroid ? { googleServicesFile: './google-services.json' } : {}) },
    extra: { ...config.extra, apiUrl: process.env.EXPO_PUBLIC_API_URL },
  };
};

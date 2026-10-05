const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Animations were removed from the app: every `react-native-reanimated` import resolves to an inert stand-in.
const noMotion = path.resolve(__dirname, 'src', 'noMotion.tsx');
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react-native-reanimated') return { type: 'sourceFile', filePath: noMotion };
  return upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

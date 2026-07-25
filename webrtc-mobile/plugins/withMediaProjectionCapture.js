const { withMainApplication, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// react-native-webrtc's getDisplayMedia screen capture on Android needs two
// native bits that live in the gitignored android/ dir, so re-apply them on
// every prebuild:
//   1. enableMediaProjectionService=true at native init, else the mediaProjection
//      foreground service never starts and MediaProjection delivers zero frames.
//   2. an `ic_notification` drawable, which the FGS notification looks up by name.

const IMPORT_LINE = 'import com.oney.WebRTCModule.WebRTCModuleOptions';
const ENABLE_LINE = 'WebRTCModuleOptions.getInstance().enableMediaProjectionService = true';

function withEnableMediaProjection(config) {
  return withMainApplication(config, (config) => {
    let src = config.modResults.contents;
    if (!src.includes(IMPORT_LINE)) {
      src = src.replace(/^(package .*)$/m, `$1\n\n${IMPORT_LINE}`);
    }
    if (!src.includes(ENABLE_LINE)) {
      src = src.replace(/(super\.onCreate\(\)\s*\n)/, `$1    ${ENABLE_LINE}\n`);
    }
    config.modResults.contents = src;
    return config;
  });
}

function withNotificationIcon(config) {
  return withDangerousMod(config, ['android', (config) => {
    const srcIcon = path.join(config.modRequest.projectRoot, 'plugins', 'ic_notification.png');
    const resRoot = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
    for (const d of ['hdpi', 'mdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
      const dir = path.join(resRoot, `drawable-${d}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(srcIcon, path.join(dir, 'ic_notification.png'));
    }
    return config;
  }]);
}

module.exports = function withMediaProjectionCapture(config) {
  config = withEnableMediaProjection(config);
  config = withNotificationIcon(config);
  return config;
};

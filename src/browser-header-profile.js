// Development-only schema shared by startup resolution and the browser adapter.
export const browserHeaderDefaults = Object.freeze({
  ApiVersion: 'browser', AppVersionCode: '1', AppVersionName: '0.0.0',
  DeviceManufacturer: 'Browser', DeviceMarketName: 'Browser', DeviceModel: 'Browser', BiometricType: 'none',
});

export function validateBrowserHeaderProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) ||
    Object.entries(profile).some(([key, value]) => !Object.hasOwn(browserHeaderDefaults, key) ||
      typeof value !== 'string' || !value || value.length > 256 || !/^[\x20-\x7e]+$/.test(value))) {
    throw new TypeError('Invalid browser header profile.');
  }
}

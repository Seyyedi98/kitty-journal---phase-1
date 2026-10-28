import * as LocalAuthentication from 'expo-local-authentication';

/** True when the device has biometric hardware AND at least one enrolled biometric. */
export async function biometricsAvailable() {
  try {
    const [hw, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return Boolean(hw && enrolled);
  } catch {
    return false;
  }
}

/**
 * Biometric prompt only — device PIN/pattern fallback is disabled so that the
 * app's own PIN stays the single fallback. Resolves true on success.
 */
export async function authenticateBiometric(promptMessage, cancelLabel) {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel,
      disableDeviceFallback: true,
    });
    return result.success === true;
  } catch {
    return false;
  }
}

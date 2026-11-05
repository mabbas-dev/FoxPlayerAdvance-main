import React from 'react';
import { Modal, Platform } from 'react-native';

/** Matches app.json landscape-only (UISupportedInterfaceOrientations). */
export const FOX_MODAL_ORIENTATIONS = ['landscape-left', 'landscape-right'];

/**
 * RN Modal defaults to portrait on iOS (breaks landscape-only apps).
 * Transparent modals must use overFullScreen — fullScreen + transparent logs a warning.
 */
export default function FoxModal({
  supportedOrientations,
  presentationStyle,
  transparent,
  ...props
}) {
  const iosOrientations =
    Platform.OS === 'ios'
      ? supportedOrientations ?? FOX_MODAL_ORIENTATIONS
      : supportedOrientations;

  let resolvedPresentation = presentationStyle;
  if (Platform.OS === 'ios' && transparent) {
    if (
      resolvedPresentation == null ||
      resolvedPresentation === 'fullScreen' ||
      resolvedPresentation === 'pageSheet' ||
      resolvedPresentation === 'formSheet'
    ) {
      resolvedPresentation = 'overFullScreen';
    }
  }

  return (
    <Modal
      {...props}
      transparent={transparent}
      presentationStyle={resolvedPresentation}
      supportedOrientations={iosOrientations}
    />
  );
}

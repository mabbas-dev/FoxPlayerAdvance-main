import { Dimensions, Platform } from 'react-native';

/**
 * Diagnostic runtime layout instrumentation for Fox Player.
 *
 * Captures and logs:
 * - Local layout coordinates and dimensions (from onLayout)
 * - True window/screen coordinates (from measureInWindow)
 * - Safe area insets
 * - Window vs Screen dimensions
 * - Boundaries comparison
 */
// Performance optimization: Disabled by default to prevent React Native bridge stalls and UI lag
const ENABLE_LAYOUT_TELEMETRY = false;

export function measureAndLogLayout(name, nodeRef, layout, insets = {}, extra = {}) {
  if (!ENABLE_LAYOUT_TELEMETRY) return;
  const win = Dimensions.get('window');
  const scr = Dimensions.get('screen');

  const printReport = (windowCoords) => {
    const layoutStr = layout
      ? `x=${Math.round(layout.x)}, y=${Math.round(layout.y)}, w=${Math.round(layout.width)}, h=${Math.round(layout.height)}`
      : 'none';
    const winCoordsStr = windowCoords
      ? `x=${Math.round(windowCoords.x)}, y=${Math.round(windowCoords.y)}, w=${Math.round(windowCoords.width)}, h=${Math.round(windowCoords.height)}`
      : 'unmeasured';
    const insetsStr = `T=${Math.round(insets?.top || 0)}, B=${Math.round(insets?.bottom || 0)}, L=${Math.round(insets?.left || 0)}, R=${Math.round(insets?.right || 0)}`;
    const dimsStr = `win=${Math.round(win.width)}x${Math.round(win.height)}, scr=${Math.round(scr.width)}x${Math.round(scr.height)}`;
    const extraStr = Object.keys(extra).length > 0 ? ` extra=${JSON.stringify(extra)}` : '';

    console.log(
      `[FoxPlayer:LayoutTelemetry] [${Platform.OS}] ${name} -> layout=[${layoutStr}] | window=[${winCoordsStr}] | insets=[${insetsStr}] | ${dimsStr}${extraStr}`
    );
  };

  if (nodeRef && nodeRef.current && typeof nodeRef.current.measureInWindow === 'function') {
    requestAnimationFrame(() => {
      try {
        nodeRef.current.measureInWindow((wx, wy, ww, wh) => {
          printReport({ x: wx, y: wy, width: ww, height: wh });
        });
      } catch (_err) {
        printReport(null);
      }
    });
  } else {
    printReport(null);
  }
}

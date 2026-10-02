import { useWindowDimensions, type ViewStyle } from 'react-native';

/**
 * Responsive helpers. Breakpoints (logical px width):
 *   xs  < 340   very small phones / tiny screens
 *   sm  < 600   phones
 *   md  < 900   large phones in landscape, small tablets
 *   lg  < 1200  tablets, small laptop windows
 *   xl  >= 1200 desktop browsers
 */
export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export function useLayout() {
  const { width, height, fontScale } = useWindowDimensions();
  const bp: Breakpoint = width < 340 ? 'xs' : width < 600 ? 'sm' : width < 900 ? 'md' : width < 1200 ? 'lg' : 'xl';
  return {
    width, height, fontScale, bp,
    isCompact: width < 360,
    isTablet: width >= 600,
    isDesktop: width >= 900,
    /** Side gutter that shrinks on tiny screens. */
    gutter: width < 340 ? 10 : width < 380 ? 14 : 16,
    /** Columns for card grids: 1 on phones, 2 on tablets, 3 on desktop. */
    columns: width < 600 ? 1 : width < 1000 ? 2 : 3,
    /** Columns for compact stat tiles: 1 on tiny screens, 2 on phones, 3 on tablets, 6 on desktop. */
    tileColumns: width < 300 ? 1 : width < 600 ? 2 : width < 1000 ? 3 : 6,
  };
}

/** Style that keeps page content in a readable centred column on big screens (full width on phones). */
export function useContentStyle(wide = false): ViewStyle {
  const { width } = useWindowDimensions();
  const max = wide ? 1100 : 640;
  return { width: '100%', maxWidth: max, alignSelf: 'center', ...(width >= max ? {} : {}) };
}

export const colors = {
  // Dark charcoal canvas & surfaces
  background: '#0B0B0F',
  backgroundElevated: '#12121A',
  surface: '#151520',
  surfaceElevated: '#1D1D2C',
  surfaceCard: '#171724',
  surfaceInput: '#13131D',

  // Borders & Dividers
  border: '#28283B',
  borderSubtle: '#1C1C2B',
  borderGold: 'rgba(229, 169, 60, 0.4)',

  // Rich amber/gold accents
  gold: '#E5A93C',
  goldLight: '#F5C66B',
  goldDark: '#B87B1D',
  goldGlow: 'rgba(229, 169, 60, 0.25)',
  goldGlass: 'rgba(229, 169, 60, 0.12)',

  // Warm ivory typography
  textPrimary: '#F7F4EB',
  textSecondary: '#B8B5AD',
  textTertiary: '#7E7B74',
  textGold: '#E5A93C',
  textInverse: '#0B0B0F',

  // Semantic & Seat States
  success: '#10B981',
  error: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',

  // Seat visual distinction tokens
  seatAvailable: '#1E1E2C',
  seatAvailableBorder: '#34344A',
  seatSelected: '#E5A93C',
  seatSelectedBorder: '#F5C66B',
  seatHeld: '#D97706',
  seatHeldBorder: '#F59E0B',
  seatSold: '#14141E',
  seatSoldBorder: '#1F1F2B',
  seatWheelchair: '#0284C7',
  seatWheelchairBorder: '#38BDF8',
  seatVipBorder: '#E5A93C',

  // Glass overlays
  glassLight: 'rgba(255, 255, 255, 0.05)',
  glassDark: 'rgba(0, 0, 0, 0.6)',
  backdropOverlay: 'rgba(7, 7, 10, 0.85)',
};

export const typography = {
  display: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '800' as const,
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  h1: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700' as const,
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  h2: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700' as const,
    color: colors.textPrimary,
  },
  h3: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  bodyLarge: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400' as const,
    color: colors.textPrimary,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400' as const,
    color: colors.textSecondary,
  },
  bodyBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500' as const,
    color: colors.textSecondary,
  },
  micro: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
};

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 48,
};

export const radii = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  round: 9999,
};

export const shadows = {
  subtle: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 2,
  },
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 4,
  },
  goldGlow: {
    shadowColor: '#E5A93C',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
};

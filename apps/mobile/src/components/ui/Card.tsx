import React from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  StyleProp,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, radii, shadows, spacing } from '../../theme';

export type CardVariant = 'default' | 'elevated' | 'glass' | 'goldBorder';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg' | 'xl';

export interface CardProps {
  children: React.ReactNode;
  variant?: CardVariant;
  padding?: CardPadding;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export const Card: React.FC<CardProps> = ({
  children,
  variant = 'default',
  padding = 'md',
  onPress,
  style,
  accessibilityLabel,
}) => {
  const handlePress = () => {
    if (!onPress) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {}
    onPress();
  };

  const getContainerStyles = (): ViewStyle[] => {
    const list: ViewStyle[] = [styles.base, styles[`padding_${padding}`]];

    if (variant === 'default') list.push(styles.variantDefault);
    else if (variant === 'elevated') list.push(styles.variantElevated);
    else if (variant === 'glass') list.push(styles.variantGlass);
    else if (variant === 'goldBorder') list.push(styles.variantGoldBorder);

    return list;
  };

  if (onPress) {
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={handlePress}
        style={[...getContainerStyles(), style]}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </TouchableOpacity>
    );
  }

  return (
    <View style={[...getContainerStyles(), style]} accessibilityLabel={accessibilityLabel}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
  // Paddings
  padding_none: {
    padding: 0,
  },
  padding_sm: {
    padding: spacing.sm,
  },
  padding_md: {
    padding: spacing.md,
  },
  padding_lg: {
    padding: spacing.lg,
  },
  padding_xl: {
    padding: spacing.xl,
  },
  // Variants
  variantDefault: {
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  variantElevated: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  variantGlass: {
    backgroundColor: 'rgba(23, 23, 36, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  variantGoldBorder: {
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.borderGold,
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
});

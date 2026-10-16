import React from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  View,
  ViewStyle,
  TextStyle,
  StyleProp,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, radii, spacing } from '../../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  iconLeading?: React.ReactNode;
  iconTrailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  iconLeading,
  iconTrailing,
  style,
  textStyle,
  accessibilityLabel,
  testID,
}) => {
  const handlePress = () => {
    if (disabled || loading) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      // Ignore if haptics unavailable on web/test
    }
    onPress();
  };

  const getContainerStyles = (): ViewStyle[] => {
    const list: ViewStyle[] = [styles.base, styles[`size_${size}`]];

    if (variant === 'primary') list.push(styles.variantPrimary);
    else if (variant === 'secondary') list.push(styles.variantSecondary);
    else if (variant === 'outline') list.push(styles.variantOutline);
    else if (variant === 'ghost') list.push(styles.variantGhost);
    else if (variant === 'danger') list.push(styles.variantDanger);

    if (disabled) list.push(styles.disabled);
    return list;
  };

  const getTextColor = (): string => {
    if (disabled) return colors.textTertiary;
    if (variant === 'primary') return colors.textInverse;
    if (variant === 'outline') return colors.gold;
    if (variant === 'danger') return '#FFFFFF';
    return colors.textPrimary;
  };

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      disabled={disabled || loading}
      style={[...getContainerStyles(), style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? colors.textInverse : colors.gold}
        />
      ) : (
        <View style={styles.contentRow}>
          {iconLeading && <View style={styles.iconLeading}>{iconLeading}</View>}
          <Text
            style={[
              styles.textBase,
              styles[`textSize_${size}`],
              { color: getTextColor() },
              textStyle,
            ]}
          >
            {title}
          </Text>
          {iconTrailing && <View style={styles.iconTrailing}>{iconTrailing}</View>}
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconLeading: {
    marginRight: spacing.sm,
  },
  iconTrailing: {
    marginLeft: spacing.sm,
  },
  textBase: {
    fontWeight: '600',
    textAlign: 'center',
  },
  // Sizes
  size_sm: {
    height: 38,
    paddingHorizontal: spacing.md,
  },
  size_md: {
    height: 48,
    paddingHorizontal: spacing.xl,
  },
  size_lg: {
    height: 56,
    paddingHorizontal: spacing.xxl,
    borderRadius: radii.lg,
  },
  textSize_sm: {
    fontSize: 13,
  },
  textSize_md: {
    fontSize: 15,
  },
  textSize_lg: {
    fontSize: 17,
    fontWeight: '700',
  },
  // Variants
  variantPrimary: {
    backgroundColor: colors.gold,
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  variantSecondary: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  variantOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.gold,
  },
  variantGhost: {
    backgroundColor: 'transparent',
  },
  variantDanger: {
    backgroundColor: colors.error,
  },
  disabled: {
    opacity: 0.45,
    shadowOpacity: 0,
    elevation: 0,
  },
});

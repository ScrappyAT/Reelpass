import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { colors, radii, spacing } from '../../theme';
import { Text } from './Text';

export type BadgeVariant =
  | 'gold'
  | 'success'
  | 'warning'
  | 'danger'
  | 'wheelchair'
  | 'imax'
  | 'dolby'
  | 'outline';

export interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const Badge: React.FC<BadgeProps> = ({
  label,
  variant = 'gold',
  icon,
  style,
}) => {
  const getBadgeStyle = (): ViewStyle => {
    switch (variant) {
      case 'success':
        return { backgroundColor: 'rgba(16, 185, 129, 0.15)', borderColor: colors.success };
      case 'warning':
        return { backgroundColor: 'rgba(245, 158, 11, 0.15)', borderColor: colors.warning };
      case 'danger':
        return { backgroundColor: 'rgba(239, 68, 68, 0.15)', borderColor: colors.error };
      case 'wheelchair':
        return { backgroundColor: 'rgba(56, 189, 248, 0.15)', borderColor: colors.seatWheelchairBorder };
      case 'imax':
        return { backgroundColor: '#1A1829', borderColor: colors.gold };
      case 'dolby':
        return { backgroundColor: '#1F1424', borderColor: '#E879F9' };
      case 'outline':
        return { backgroundColor: 'transparent', borderColor: colors.border };
      case 'gold':
      default:
        return { backgroundColor: colors.goldGlass, borderColor: colors.borderGold };
    }
  };

  const getTextColor = (): string => {
    switch (variant) {
      case 'success':
        return colors.success;
      case 'warning':
        return colors.warning;
      case 'danger':
        return colors.error;
      case 'wheelchair':
        return colors.seatWheelchairBorder;
      case 'dolby':
        return '#F0ABFC';
      case 'outline':
        return colors.textSecondary;
      case 'gold':
      case 'imax':
      default:
        return colors.gold;
    }
  };

  return (
    <View style={[styles.badge, getBadgeStyle(), style]}>
      {icon && <View style={styles.icon}>{icon}</View>}
      <Text variant="micro" style={{ color: getTextColor() }}>
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.round,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  icon: {
    marginRight: 4,
  },
});

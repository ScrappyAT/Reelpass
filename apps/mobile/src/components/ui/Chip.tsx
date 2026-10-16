import React from 'react';
import {
  TouchableOpacity,
  View,
  StyleSheet,
  ViewStyle,
  StyleProp,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, radii, spacing } from '../../theme';
import { Text } from './Text';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: React.ReactNode;
  count?: number;
  style?: StyleProp<ViewStyle>;
}

export const Chip: React.FC<ChipProps> = ({
  label,
  selected = false,
  onPress,
  icon,
  count,
  style,
}) => {
  const handlePress = () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {}
    onPress();
  };

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      style={[
        styles.chip,
        selected ? styles.chipSelected : styles.chipUnselected,
        style,
      ]}
      accessibilityRole="checkbox"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}${selected ? ', selected' : ''}`}
    >
      {icon && <View style={styles.icon}>{icon}</View>}
      <Text
        variant="caption"
        style={[
          styles.label,
          selected ? styles.labelSelected : styles.labelUnselected,
        ]}
      >
        {label}
      </Text>
      {count !== undefined && (
        <View
          style={[
            styles.countBadge,
            selected ? styles.countSelected : styles.countUnselected,
          ]}
        >
          <Text
            variant="micro"
            style={selected ? styles.countTextSelected : styles.countTextUnselected}
          >
            {count}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.round,
    marginRight: spacing.sm,
  },
  chipUnselected: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: {
    backgroundColor: colors.gold,
    borderWidth: 1,
    borderColor: colors.goldLight,
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  icon: {
    marginRight: spacing.xs,
  },
  label: {
    fontWeight: '600',
  },
  labelUnselected: {
    color: colors.textSecondary,
  },
  labelSelected: {
    color: colors.textInverse,
    fontWeight: '700',
  },
  countBadge: {
    marginLeft: spacing.xs,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.round,
  },
  countUnselected: {
    backgroundColor: colors.surfaceCard,
  },
  countSelected: {
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  countTextUnselected: {
    color: colors.textTertiary,
  },
  countTextSelected: {
    color: colors.textInverse,
  },
});

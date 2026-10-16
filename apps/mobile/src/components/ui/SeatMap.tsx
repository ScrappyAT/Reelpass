import React, { memo } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  StyleProp,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Seat, formatNaira } from '@matinee/shared';
import { colors, spacing } from '../../theme';
import { Text } from './Text';

export interface SeatMapProps {
  seats: Seat[];
  selectedSeatIds: string[];
  onToggleSeat: (seat: Seat) => void;
  maxSelection?: number;
  screenType?: string;
  style?: StyleProp<ViewStyle>;
}

// 1. Optimized Memoized Seat Item
interface SeatItemProps {
  seat: Seat;
  isSelected: boolean;
  onPress: (seat: Seat) => void;
}

const SeatItem = memo<SeatItemProps>(
  ({ seat, isSelected, onPress }) => {
    const isAvailable = seat.status === 'available';
    const isHeld = seat.status === 'held';
    const isSold = seat.status === 'sold';
    const isWheelchair = seat.type === 'wheelchair';
    const isVip = seat.type === 'vip';

    const handlePress = () => {
      if (!isAvailable) return;
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch (e) {}
      onPress(seat);
    };

    // Style resolution based on seat status and type
    const getSeatStyle = (): ViewStyle => {
      if (isSelected) {
        return {
          backgroundColor: colors.seatSelected,
          borderColor: colors.seatSelectedBorder,
          shadowColor: colors.gold,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.5,
          shadowRadius: 5,
          elevation: 4,
        };
      }

      if (isSold) {
        return {
          backgroundColor: colors.seatSold,
          borderColor: colors.seatSoldBorder,
          opacity: 0.4,
        };
      }

      if (isHeld) {
        return {
          backgroundColor: colors.seatHeld,
          borderColor: colors.seatHeldBorder,
          opacity: 0.85,
        };
      }

      if (isWheelchair) {
        return {
          backgroundColor: colors.seatWheelchair,
          borderColor: colors.seatWheelchairBorder,
        };
      }

      if (isVip) {
        return {
          backgroundColor: colors.seatAvailable,
          borderColor: colors.seatVipBorder,
          borderWidth: 1.5,
        };
      }

      // Standard available
      return {
        backgroundColor: colors.seatAvailable,
        borderColor: colors.seatAvailableBorder,
      };
    };

    const getAccessibilityLabel = (): string => {
      let state = 'Available';
      if (isSelected) state = 'Selected';
      else if (isHeld) state = 'Held';
      else if (isSold) state = 'Sold';
      return `Seat ${seat.label}, ${seat.type} type, ${state}, price ${formatNaira(seat.price)}`;
    };

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        disabled={!isAvailable}
        onPress={handlePress}
        style={[styles.seatBase, getSeatStyle()]}
        accessibilityRole="checkbox"
        accessibilityLabel={getAccessibilityLabel()}
        accessibilityState={{
          selected: isSelected,
          disabled: !isAvailable,
        }}
      >
        {isWheelchair ? (
          <Ionicons
            name="body-outline"
            size={10}
            color={isSelected ? colors.textInverse : '#FFFFFF'}
          />
        ) : (
          <Text
            variant="micro"
            style={[
              styles.seatNumber,
              { color: isSelected ? colors.textInverse : colors.textSecondary },
            ]}
          >
            {seat.number}
          </Text>
        )}
      </TouchableOpacity>
    );
  },
  (prev, next) =>
    prev.isSelected === next.isSelected &&
    prev.seat.status === next.seat.status &&
    prev.seat.id === next.seat.id
);

SeatItem.displayName = 'SeatItem';

// 2. High Performance Full Seat Map
export const SeatMap: React.FC<SeatMapProps> = ({
  seats,
  selectedSeatIds,
  onToggleSeat,
  screenType = 'IMAX 2D',
  style,
}) => {
  // Group seats by row (e.g. A to P)
  const rowsMap = React.useMemo(() => {
    const map = new Map<string, Seat[]>();
    seats.forEach((seat) => {
      const existing = map.get(seat.row) || [];
      existing.push(seat);
      map.set(seat.row, existing);
    });
    return map;
  }, [seats]);

  const sortedRows = React.useMemo(() => {
    return Array.from(rowsMap.keys()).sort();
  }, [rowsMap]);

  const selectedSet = React.useMemo(() => new Set(selectedSeatIds), [selectedSeatIds]);

  return (
    <View style={[styles.container, style]}>
      {/* Curved Screen Visualization */}
      <View style={styles.screenWrapper}>
        <View style={styles.curvedScreen} />
        <Text variant="micro" color="secondary" style={styles.screenLabel}>
          {screenType} SCREEN
        </Text>
      </View>

      {/* Visual Legend */}
      <View style={styles.legendContainer}>
        <View style={styles.legendItem}>
          <View style={[styles.legendIndicator, { backgroundColor: colors.seatAvailable, borderColor: colors.seatAvailableBorder }]} />
          <Text variant="micro" color="secondary">Available</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendIndicator, { backgroundColor: colors.seatSelected, borderColor: colors.seatSelectedBorder }]} />
          <Text variant="micro" color="gold">Selected</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendIndicator, { backgroundColor: colors.seatHeld, borderColor: colors.seatHeldBorder }]} />
          <Text variant="micro" color="warning">Held</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendIndicator, { backgroundColor: colors.seatSold, borderColor: colors.seatSoldBorder, opacity: 0.5 }]} />
          <Text variant="micro" color="tertiary">Sold</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendIndicator, { backgroundColor: colors.seatWheelchair, borderColor: colors.seatWheelchairBorder }]} />
          <Text variant="micro" style={{ color: colors.seatWheelchairBorder }}>Accessible</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendIndicator, { backgroundColor: colors.seatAvailable, borderColor: colors.gold, borderWidth: 1.5 }]} />
          <Text variant="micro" color="gold">VIP</Text>
        </View>
      </View>

      {/* 300+ Seats Scrollable Grid */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScrollContent}
      >
        <View style={styles.grid}>
          {sortedRows.map((rowLabel) => {
            const rowSeats = rowsMap.get(rowLabel) || [];
            return (
              <View key={rowLabel} style={styles.row}>
                {/* Left Row Label */}
                <View style={styles.rowLabelWrapper}>
                  <Text variant="caption" color="tertiary" style={styles.rowLabelText}>
                    {rowLabel}
                  </Text>
                </View>

                {/* Seats in Row */}
                <View style={styles.rowSeats}>
                  {rowSeats.map((seat, index) => {
                    // Add aisle space between seats 5 & 6, and 15 & 16
                    const isAisle = index === 4 || index === 14;
                    return (
                      <React.Fragment key={seat.id}>
                        <SeatItem
                          seat={seat}
                          isSelected={selectedSet.has(seat.id)}
                          onPress={onToggleSeat}
                        />
                        {isAisle && <View style={styles.aisleSpace} />}
                      </React.Fragment>
                    );
                  })}
                </View>

                {/* Right Row Label */}
                <View style={styles.rowLabelWrapper}>
                  <Text variant="caption" color="tertiary" style={styles.rowLabelText}>
                    {rowLabel}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingVertical: spacing.md,
  },
  screenWrapper: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  curvedScreen: {
    width: '75%',
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.gold,
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 8,
    transform: [{ scaleX: 1.05 }],
  },
  screenLabel: {
    marginTop: spacing.xs,
    letterSpacing: 2,
    fontSize: 9,
  },
  legendContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendIndicator: {
    width: 12,
    height: 12,
    borderRadius: 3,
    borderWidth: 1,
  },
  horizontalScrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  grid: {
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  rowLabelWrapper: {
    width: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabelText: {
    fontWeight: '700',
    fontSize: 11,
  },
  rowSeats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  seatBase: {
    width: 20,
    height: 20,
    marginHorizontal: 2,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatNumber: {
    fontSize: 8,
    fontWeight: '700',
  },
  aisleSpace: {
    width: 14,
  },
});

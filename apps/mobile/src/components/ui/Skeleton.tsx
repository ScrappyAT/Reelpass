import React, { useEffect, useState } from 'react';
import {
  Animated,
  StyleSheet,
  ViewStyle,
  StyleProp,
  DimensionValue,
} from 'react-native';
import { colors, radii } from '../../theme';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = 20,
  borderRadius = radii.sm,
  style,
}) => {
  const [pulseAnim] = useState(() => new Animated.Value(0.3));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.75,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius,
          opacity: pulseAnim,
        },
        style,
      ]}
    />
  );
};

// Preset Skeletons for movie poster, card, avatar, etc.
export const SkeletonPoster: React.FC<{ style?: StyleProp<ViewStyle> }> = ({ style }) => (
  <Skeleton width={148} height={220} borderRadius={radii.lg} style={style} />
);

export const SkeletonText: React.FC<{
  lines?: number;
  lastLineWidth?: DimensionValue;
  style?: StyleProp<ViewStyle>;
}> = ({ lines = 3, lastLineWidth = '60%', style }) => (
  <Animated.View style={style}>
    {Array.from({ length: lines }).map((_, idx) => (
      <Skeleton
        key={idx}
        width={idx === lines - 1 ? lastLineWidth : '100%'}
        height={14}
        borderRadius={radii.xs}
        style={{ marginBottom: 8 }}
      />
    ))}
  </Animated.View>
);

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: colors.surfaceElevated,
  },
});

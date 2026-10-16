import React, { createContext, useContext, useState, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, radii, shadows, spacing } from '../../theme';
import { Text } from './Text';

export type ToastType = 'success' | 'error' | 'info' | 'gold';

export interface ToastOptions {
  title?: string;
  message: string;
  type?: ToastType;
  duration?: number;
}

interface ToastContextType {
  showToast: (options: ToastOptions) => void;
  hideToast: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastOptions | null>(null);
  const [translateY] = useState(() => new Animated.Value(-100));
  const [opacity] = useState(() => new Animated.Value(0));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideToast = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -100,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setToast(null);
    });
  };

  const showToast = (options: ToastOptions) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(options);

    try {
      if (options.type === 'error') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else if (options.type === 'success') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (e) {}

    Animated.parallel([
      Animated.spring(translateY, {
        toValue: insets.top + 10,
        friction: 8,
        tension: 50,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    timerRef.current = setTimeout(() => {
      hideToast();
    }, options.duration || 3500);
  };

  const getIcon = (type: ToastType = 'gold') => {
    switch (type) {
      case 'success':
        return <Ionicons name="checkmark-circle" size={22} color={colors.success} />;
      case 'error':
        return <Ionicons name="alert-circle" size={22} color={colors.error} />;
      case 'info':
        return <Ionicons name="information-circle" size={22} color={colors.info} />;
      case 'gold':
      default:
        return <Ionicons name="sparkles" size={20} color={colors.gold} />;
    }
  };

  const getBorderColor = (type: ToastType = 'gold') => {
    switch (type) {
      case 'success':
        return colors.success;
      case 'error':
        return colors.error;
      case 'info':
        return colors.info;
      case 'gold':
      default:
        return colors.gold;
    }
  };

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      {toast && (
        <Animated.View
          style={[
            styles.toastContainer,
            {
              transform: [{ translateY }],
              opacity,
              borderColor: getBorderColor(toast.type),
            },
          ]}
        >
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={hideToast}
            style={styles.toastContent}
            accessibilityRole="alert"
          >
            <View style={styles.iconContainer}>{getIcon(toast.type)}</View>
            <View style={styles.textContainer}>
              {toast.title && (
                <Text variant="caption" color="primary" style={styles.title}>
                  {toast.title}
                </Text>
              )}
              <Text variant="caption" color="secondary" numberOfLines={2}>
                {toast.message}
              </Text>
            </View>
          </TouchableOpacity>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

const styles = StyleSheet.create({
  toastContainer: {
    position: 'absolute',
    top: 0,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    ...shadows.card,
    zIndex: 9999,
  },
  toastContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  iconContainer: {
    marginRight: spacing.sm,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontWeight: '700',
    marginBottom: 2,
  },
});

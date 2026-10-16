import React from 'react';
import {
  Text as RNText,
  TextProps as RNTextProps,
  StyleProp,
  TextStyle,
} from 'react-native';
import { colors, typography } from '../../theme';

export type TextVariant =
  | 'display'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bodyLarge'
  | 'body'
  | 'bodyBold'
  | 'caption'
  | 'micro';

export type TextColor = 'primary' | 'secondary' | 'tertiary' | 'gold' | 'error' | 'success' | 'warning';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: TextColor;
  align?: 'left' | 'center' | 'right';
  style?: StyleProp<TextStyle>;
  children: React.ReactNode;
}

export const Text: React.FC<TextProps> = ({
  variant = 'body',
  color = 'primary',
  align = 'left',
  style,
  children,
  ...props
}) => {
  const getTextColor = (): string => {
    switch (color) {
      case 'secondary':
        return colors.textSecondary;
      case 'tertiary':
        return colors.textTertiary;
      case 'gold':
        return colors.gold;
      case 'warning':
        return colors.warning;
      case 'error':
        return colors.error;
      case 'success':
        return colors.success;
      case 'primary':
      default:
        return colors.textPrimary;
    }
  };

  return (
    <RNText
      style={[
        typography[variant],
        { color: getTextColor(), textAlign: align },
        style,
      ]}
      {...props}
    >
      {children}
    </RNText>
  );
};

// FALLBACK cat picture (plain emoji, no extra packages).
// If you recover your original CatIllustration.js, use that instead.
import React from 'react';
import { View } from 'react-native';
import { Text } from '../ui';

export default function CatIllustration({ width = 100, height = 100 }) {
  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }} accessible={false}>
      <Text style={{ fontSize: Math.min(width, height) * 0.8, lineHeight: Math.min(width, height) }}>🐱</Text>
    </View>
  );
}

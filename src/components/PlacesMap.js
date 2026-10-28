import React, { useMemo } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { MAP_BASE_URL, buildMapHtml } from '../utils/mapPlaces';

/**
 * Interactive map (Leaflet + OpenStreetMap inside a WebView). Markers show a
 * small photo of the entry written there. Only data our own page posts back
 * is accepted, and only for marker keys we sent.
 */
export default function PlacesMap({ groups, images, background, accent, offlineText, onSelect, onDeselect, onOffline, height = 360 }) {
  const html = useMemo(
    () => buildMapHtml({ groups, images, background, accent, offlineText }),
    [groups, images, background, accent, offlineText],
  );
  const keys = useMemo(() => new Set(groups.map((g) => g.key)), [groups]);

  const onMessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'select' && typeof msg.key === 'string' && keys.has(msg.key)) onSelect?.(msg.key);
    else if (msg.type === 'deselect') onDeselect?.();
    else if (msg.type === 'offline') onOffline?.();
  };

  return (
    <View style={{ height, borderRadius: 18, overflow: 'hidden', backgroundColor: background }}>
      <WebView
        originWhitelist={['*']}
        source={{ html, baseUrl: MAP_BASE_URL }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled={false}
        nestedScrollEnabled
        setSupportMultipleWindows={false}
        // The page never navigates away; block anything that tries to.
        onShouldStartLoadWithRequest={(req) => req.url === MAP_BASE_URL || req.url.startsWith('about:') || req.url.startsWith('data:')}
        style={{ flex: 1, backgroundColor: background }}
        accessibilityLabel="map"
      />
    </View>
  );
}

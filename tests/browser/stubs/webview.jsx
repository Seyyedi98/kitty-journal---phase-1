import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

// Stand-in for react-native-webview: an <iframe srcDoc>, with the native
// bridge (window.ReactNativeWebView.postMessage) wired back to onMessage and
// injectJavaScript() evaluated inside the frame.
export const WebView = forwardRef(function WebView({ source, onMessage, style }, outerRef) {
  const ref = useRef(null);
  useImperativeHandle(outerRef, () => ({
    injectJavaScript(js) {
      try { ref.current?.contentWindow?.eval(js); } catch (e) { window.__errors?.push('inject: ' + e.message); }
    },
  }));
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  useEffect(() => {
    const handler = (e) => {
      if (e.source === ref.current?.contentWindow && e.data && e.data.__rn) onMessageRef.current?.({ nativeEvent: { data: e.data.__rn } });
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);
  const bridge = '<script>window.ReactNativeWebView={postMessage:function(m){parent.postMessage({__rn:m},"*");}};</script>';
  const html = String(source.html).replace('<head>', '<head>' + bridge);
  const isEditor = html.includes('id="ed"');
  return <iframe ref={ref} data-testid={isEditor ? 'editor-frame' : 'map-frame'} srcDoc={html} style={{ border: 0, width: '100%', height: 360, ...(style || {}) }} />;
});

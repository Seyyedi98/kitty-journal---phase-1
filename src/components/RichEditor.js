import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { WebView } from 'react-native-webview';
import { buildEditorHtml } from '../utils/richEditorHtml';
import { sanitizeHtml } from '../utils/richText';

/**
 * The body editor. The initial `html` is read once when the component mounts —
 * give it a new `key` to load different content. Text is reported through
 * `onChange(sanitisedHtml)` on every edit, never on load.
 */
const RichEditor = forwardRef(function RichEditor(
  { html, colors, rtl, placeholder, minHeight = 220, onChange, onState, onCaret, onFocusChange },
  ref,
) {
  const web = useRef(null);
  const [height, setHeight] = useState(minHeight);
  const source = useMemo(
    () => ({ html: buildEditorHtml({ html, rtl, placeholder, minHeight, colors }) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useImperativeHandle(ref, () => ({
    exec(cmd, arg) {
      if (web.current) web.current.injectJavaScript(`window.__cmd(${JSON.stringify(cmd)}, ${JSON.stringify(arg === undefined ? null : arg)});true;`);
    },
    focus() {
      if (web.current) web.current.injectJavaScript('window.__focus();true;');
    },
  }));

  const onMessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.t === 'change') onChange?.(sanitizeHtml(m.html, { dropColor: colors && colors.ink }));
    else if (m.t === 'state') onState?.(m.s);
    else if (m.t === 'height') setHeight(Math.max(minHeight, Math.min(m.h, 20000)));
    else if (m.t === 'caret') onCaret?.(m.y);
    else if (m.t === 'focus') onFocusChange?.(Boolean(m.v));
  };

  return (
    <WebView
      ref={web}
      originWhitelist={['about:*']}
      source={source}
      onMessage={onMessage}
      style={{ height, backgroundColor: 'transparent' }}
      containerStyle={{ backgroundColor: 'transparent' }}
      scrollEnabled={false}
      nestedScrollEnabled
      overScrollMode="never"
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      javaScriptEnabled
      domStorageEnabled={false}
      allowFileAccess={false}
      setSupportMultipleWindows={false}
      hideKeyboardAccessoryView
      keyboardDisplayRequiresUserAction={false}
      automaticallyAdjustContentInsets={false}
      textZoom={100}
      onShouldStartLoadWithRequest={(r) => r.url === 'about:blank' || r.url.startsWith('about:')}
    />
  );
});

export default RichEditor;

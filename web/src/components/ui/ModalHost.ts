import { createContext } from 'react';

/// Where a `Modal` renders its `<dialog>` when its owner sits inside an animated or transformed
/// element. A modal dialog that lives inside such an element, once shown and removed a few times,
/// leaves that element's content unreachable by touch in the Android WebView: taps land on the
/// scroller behind it until the element is rebuilt. A host outside the animated element avoids it.
/// With no host the dialog renders in place, as everywhere else in the app.
export const ModalHostContext = createContext<HTMLElement | null>(null);

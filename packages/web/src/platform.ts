/**
 * Whether this page is Writer's Android app (packages/mobile, D16): its webview serves the page
 * itself from tauri.localhost, and the engine runs in it. There are no folders of the writer's to
 * open there: books come from New book or from GitHub, into the app's own storage.
 */
export const onAndroid = location.hostname === "tauri.localhost" && "__TAURI_INTERNALS__" in window;

/**
 * Whether the engine runs in this page (#51): in the Android app, or where a server that only
 * bridges to its ports says so (writer serve --engine-in-page). The page is then the app: closing it,
 * or Android killing it, is Writer stopping.
 */
export const engineInPage = onAndroid || document.querySelector('meta[name="writer-engine"]') !== null;

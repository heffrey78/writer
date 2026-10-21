/**
 * Whether this page is Writer's Android app (packages/mobile, D16): its webview serves the page
 * itself from tauri.localhost, and the engine runs in it. There are no folders of the writer's to
 * open there: books come from New book or from GitHub, into the app's own storage.
 */
export const onAndroid = location.hostname === "tauri.localhost" && "__TAURI_INTERNALS__" in window;

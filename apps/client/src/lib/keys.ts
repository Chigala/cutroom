/** Shortcut labels as this computer writes them: ⌘ on a Mac, Ctrl elsewhere. */
export const isMac = navigator.userAgent.includes("Mac");
/** The command key, ready to put in front of another key: "⌘" or "Ctrl+". */
export const mod = isMac ? "⌘" : "Ctrl+";

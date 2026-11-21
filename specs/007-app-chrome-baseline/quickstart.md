# Quickstart: Keyboard Shortcuts Help and Tab Closing

## Prerequisites

- A built or development docdeck with at least one Markdown document available.

## Steps

1. Run `npm run tauri dev`.
2. Press `?` with the document area focused.
   - The Help dialog opens on the **Shortcuts** tab.
   - Every registered shortcut is listed with a description.
3. Press `Esc`.
   - The dialog closes and focus returns to the previous control.
4. Click into the browse filter or press `Ctrl+F`, then type `?`.
   - The character is inserted; Help does not open.
5. Click **? Help** in the header.
   - The same dialog opens.
6. Select the **Manual** tab.
   - Headings, lists, tables and code spans render as Markdown.
7. Press `Esc`, then press `?` again.
   - Help reopens on **Shortcuts**, not on Manual.
8. Open two documents, activate one, and press `Ctrl+W`.
   - The active document closes; the other remains active.
   - The application window stays open.
9. Press `Ctrl+Shift+T`.
   - The document closed in step 8 reopens.
10. Close the last open document with `Ctrl+W`.
    - The empty state is shown; docdeck does not quit.
11. Open help, then press `Ctrl+W`.
    - No document closes while the dialog is open.

## Expected

- Help works offline and appears immediately.
- `Ctrl+W` is shown as `Ctrl+W` on Linux, macOS and Windows.
- On macOS, `Cmd+W` remains the operating system's window action.

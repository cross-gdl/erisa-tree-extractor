# ERISA Tree Extractor

Chrome extension for extracting ERISA regulatory tree structures into CSV format.

## What it does

Works on web pages that display IRS and DOL statutes/regulations in a Fancytree widget. The extension:

1. **Expands** nested folder nodes in the regulatory tree so the full structure is visible.
2. **Extracts** the tree hierarchy into a 3-level CSV and copies it to your clipboard.

## Permissions

- `activeTab` — only operates on the currently active browser tab when clicked.
- `scripting` — injects a content script to read the Fancytree DOM and copy results to clipboard.

No network requests. No external APIs. No data sent or stored anywhere.

## Installation (unpacked)

1. Clone this repo.
2. Open `chrome://extensions/` and enable **Developer mode**.
3. Click **Load unpacked** and select this directory.
4. Navigate to a page with an ERISA Fancytree widget and click the extension icon.

## Usage

1. Select which folders to extract (IRS Statutes, IRS Regulations, DOL Statutes, DOL Regulations).
2. Click **Expand Selected Folders** and wait a few seconds for the tree to fully load.
3. Click **Copy CSV to Clipboard** to copy the extracted hierarchy.
4. Paste into a spreadsheet or text editor.

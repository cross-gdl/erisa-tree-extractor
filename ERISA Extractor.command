#!/bin/bash
# Double-click this file to run the ERISA Tree Extractor.
# On first run, it will install dependencies automatically.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

NODE_PATH="$(which node 2>/dev/null)"

if [ -z "$NODE_PATH" ]; then
    echo ""
    echo "Node.js is required but not installed."
    echo "Install it from https://nodejs.org/ and try again."
    echo ""
    read -p "Press Enter to close."
    exit 1
fi

# Install npm dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "First-time setup: installing dependencies..."
    npm install --ignore-scripts
    echo ""
fi


echo "Starting ERISA Extractor..."
echo ""

"$NODE_PATH" extract.js

if [ $? -eq 0 ]; then
    osascript -e 'display notification "ERISA tree extraction complete." with title "ERISA Extractor" sound name "Glass"'
else
    osascript -e 'display notification "Extraction failed. See terminal for details." with title "ERISA Extractor" sound name "Basso"'
fi

echo ""
echo "Done. Press any key to close this window."
read -n 1 -s

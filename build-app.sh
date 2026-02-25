#!/bin/bash
#
# Builds "ERISA Extractor.app" — a double-clickable Mac application
# that runs the Puppeteer extraction script.
#
# Usage: ./build-app.sh
#
# Prerequisites: Node.js must be installed.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="ERISA Extractor"
APP_PATH="$SCRIPT_DIR/$APP_NAME.app"

echo "Installing dependencies..."
cd "$SCRIPT_DIR"
npm install --silent --ignore-scripts

echo "Building $APP_NAME.app..."

NODE_PATH="$(which node)"

# Create a launcher shell script that the .app will invoke
cat > "$SCRIPT_DIR/launch.sh" <<LAUNCHER
#!/bin/bash
cd "$SCRIPT_DIR"

if [ ! -d "node_modules" ]; then
    echo "First-time setup: installing dependencies..."
    npm install --ignore-scripts
    echo ""
fi

echo "Starting ERISA Extractor..."
echo ""

"$NODE_PATH" extract.js
EXIT_CODE=\$?
if [ \$EXIT_CODE -eq 0 ]; then
    osascript -e 'display notification "ERISA tree extraction complete." with title "ERISA Extractor" sound name "Glass"'
else
    osascript -e 'display notification "Extraction failed. Check the terminal for details." with title "ERISA Extractor" sound name "Basso"'
fi
echo ""
echo "Done. Press any key to close this window."
read -n 1 -s
LAUNCHER
chmod +x "$SCRIPT_DIR/launch.sh"

# Create AppleScript that opens Terminal with the launcher
APPLESCRIPT=$(cat <<'ENDSCRIPT'
on run
    set launchScript to (POSIX path of (path to me)) & "../launch.sh"
    tell application "Terminal"
        activate
        do script "exec " & quoted form of launchScript
    end tell
end run
ENDSCRIPT
)

rm -rf "$APP_PATH"

echo "$APPLESCRIPT" | osacompile -o "$APP_PATH"

if [ -f "$SCRIPT_DIR/chrome-extension/icon.png" ]; then
    cp "$SCRIPT_DIR/chrome-extension/icon.png" "$APP_PATH/Contents/Resources/applet.png" 2>/dev/null || true
fi

echo ""
echo "Built: $APP_PATH"
echo ""
echo "Double-click '$APP_NAME.app' to run the extractor."
echo "On first run, a Chrome window will open for you to log in."
echo "Subsequent runs will use the saved session."

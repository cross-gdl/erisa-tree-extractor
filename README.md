# ERISA Tree Extractor

Extracts ERISA regulatory tree structures (IRS/DOL statutes and regulations) from [ERISApedia](https://app.erisapedia.com) into CSV format, with optional Google Sheets export.

## Quick Start (Mac)

**Prerequisites:** [Node.js](https://nodejs.org/) must be installed.

1. Clone this repo
2. Double-click **`ERISA Extractor.command`**

On first run, dependencies and a bundled Chrome browser are installed automatically. A Chrome window opens for you to log in to ERISApedia — subsequent runs use the saved session.

The extracted CSV is saved locally and optionally pushed to a Google Sheet.

## Google Sheets Integration

1. Create a Google Sheet and open **Extensions > Apps Script**
2. Paste the contents of `apps-script/Code.gs` and deploy as a web app (Execute as: Me, Access: Anyone)
3. Copy the deployment URL into `config.json` under `googleSheetWebAppUrl`

Data is written to a sheet tab called "All Sources".

## Configuration

Edit `config.json` to customize:

```json
{
  "folders": ["IRS Statutes", "IRS Regulations", "DOL Statutes", "DOL Regulations"],
  "loginUrl": "https://app.erisapedia.com/login",
  "googleSheetWebAppUrl": ""
}
```

## CLI Usage

```bash
node extract.js                                        # extract all configured folders
node extract.js --folders "IRS Statutes,DOL Statutes"  # specific folders
node extract.js --output my-file.csv                   # custom output path
node extract.js --keep-open                            # leave browser open after extraction
```

## Chrome Extension (Alternative)

A Chrome extension is also available in the `chrome-extension/` folder:

1. Open `chrome://extensions/` and enable **Developer mode**
2. Click **Load unpacked** and select the `chrome-extension/` directory
3. Navigate to ERISApedia and click the extension icon

## Project Structure

```
├── ERISA Extractor.command   # Double-click to run (Mac)
├── extract.js                # Puppeteer extraction script
├── config.json               # Shared configuration
├── apps-script/Code.gs       # Google Sheets Apps Script endpoint
├── build-app.sh              # Builds a .app bundle (optional)
├── chrome-extension/         # Chrome extension (alternative approach)
└── .puppeteerrc.cjs          # Puppeteer cache config
```

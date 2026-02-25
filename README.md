# ERISA Tree Extractor

Extracts ERISA regulatory tree structures (IRS/DOL statutes and regulations) from [ERISApedia](https://app.erisapedia.com) into CSV format, with optional Google Sheets export.

## Setup (Mac, one-time)

### Step 1: Prerequisites

You need two things installed (you probably already have Chrome):

- **Google Chrome** — download from [google.com/chrome](https://www.google.com/chrome/) if you don't have it
- **Node.js** — go to [nodejs.org](https://nodejs.org/), click the big green button to download the LTS installer, open it and follow the prompts

### Step 2: Download the extractor

1. Go to [this project's GitHub page](https://github.com/cross-gdl/erisa-tree-extractor)
2. Click the green **Code** button, then click **Download ZIP**
3. Open the downloaded ZIP — macOS will unzip it into your Downloads folder
4. Move the `erisa-tree-extractor` folder somewhere convenient (e.g., your Desktop)

### Step 3: First run

1. Open the `erisa-tree-extractor` folder
2. Double-click **`ERISA Extractor.command`**
3. If macOS says the file can't be opened: right-click it, choose **Open**, then click **Open** again in the popup
4. A Terminal window will appear — on first run it will install dependencies (this takes a minute or two)
5. A Chrome window will open to the ERISApedia login page — log in as usual
6. Once logged in, the script expands all folders and extracts the data automatically
7. When it says "Done", press any key to close the Terminal window

### Running it again

Just double-click **`ERISA Extractor.command`**. Your login session is saved, so you won't need to log in again unless the session expires.

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

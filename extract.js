const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
const DEFAULT_FOLDERS = config.folders;
const TARGET_URL = config.loginUrl;

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { folders: DEFAULT_FOLDERS, output: null, keepOpen: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--folders' && args[i + 1]) {
      opts.folders = args[++i].split(',').map(s => s.trim());
    } else if (args[i] === '--output' && args[i + 1]) {
      opts.output = args[++i];
    } else if (args[i] === '--keep-open') {
      opts.keepOpen = true;
    }
  }

  if (!opts.output) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    opts.output = `erisa-tree-${ts}.csv`;
  }

  return opts;
}

async function waitForLogin(page) {
  console.log('Checking login state...');

  try {
    const treeExists = await page.$('#tree');
    if (treeExists) {
      console.log('Already logged in. Tree found.');
      return;
    }
  } catch {}

  console.log('');
  console.log('==> Please log in to erisapedia.com in the browser window.');
  console.log('==> The script will continue automatically when the tree loads.');
  console.log('');

  while (true) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const found = await page.$('#tree');
      if (found) {
        console.log('Login detected. Tree found.');
        return;
      }
    } catch {
      // Page is navigating (login redirect) — keep waiting
    }
  }
}

async function expandFolders(page, folders) {
  console.log(`Expanding folders: ${folders.join(', ')}...`);

  const result = await page.evaluate(async (targets) => {
    const tree = jQuery('#tree').fancytree('getTree');
    if (!tree) return { error: 'Fancytree not found on this page.' };

    const BATCH_SIZE = 5;
    const EXPAND_DELAY = 100;

    async function expandNode(node) {
      if (!node.isExpanded() && (node.hasChildren() || node.lazy)) {
        try {
          await node.setExpanded(true);
        } catch (e) {}
        await new Promise(r => setTimeout(r, EXPAND_DELAY));
      }
      if (node.children) {
        for (let i = 0; i < node.children.length; i += BATCH_SIZE) {
          const batch = node.children.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map(child => expandNode(child)));
        }
      }
    }

    const rootNodes = [];
    tree.visit(node => {
      if (targets.includes(node.title.trim())) {
        rootNodes.push(node);
      }
    });

    for (const node of rootNodes) {
      await expandNode(node);
    }

    return { expanded: rootNodes.length };
  }, folders);

  if (result.error) {
    throw new Error(result.error);
  }

  console.log(`Expanded ${result.expanded} root folder(s).`);
}

async function extractCSV(page, folders) {
  console.log('Extracting tree data...');

  const csvText = await page.evaluate((targets) => {
    const tree = jQuery('#tree').fancytree('getTree');
    if (!tree) return null;

    function csvEscape(val) {
      if (val == null) return '';
      const s = String(val);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }

    const rows = [['Level 1', 'Level 2', 'Level 3']];

    function walk(node, ancestors) {
      const nodePath = ancestors.concat(node.title);
      if (!node.children || node.children.length === 0) {
        rows.push([nodePath[0] || '', nodePath[1] || '', nodePath[2] || '']);
      } else {
        node.children.forEach(child => walk(child, nodePath));
      }
    }

    tree.visit(node => {
      if (targets.includes(node.title.trim())) {
        walk(node, []);
      }
    });

    return rows.map(r => r.map(csvEscape).join(',')).join('\n');
  }, folders);

  if (!csvText) {
    throw new Error('Failed to extract tree data.');
  }

  return csvText;
}

async function pushToGoogleSheet(csvText) {
  console.log('Pushing CSV to Google Sheet...');
  try {
    // Google Apps Script redirects POST -> GET. Follow manually to get JSON.
    const res = await fetch(config.googleSheetWebAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: csvText,
      redirect: 'manual',
    });

    let finalRes = res;
    if (res.status >= 300 && res.status < 400) {
      const redirectUrl = res.headers.get('location');
      if (redirectUrl) {
        finalRes = await fetch(redirectUrl, { redirect: 'follow' });
      }
    }

    const text = await finalRes.text();
    try {
      const data = JSON.parse(text);
      if (data.success) {
        console.log(`Google Sheet updated (${data.rows} rows).`);
      } else {
        console.error('Google Sheet error:', data.error);
      }
    } catch {
      if (finalRes.ok) {
        console.log('Google Sheet updated (response was not JSON, but request succeeded).');
      } else {
        console.error('Google Sheet error: unexpected response.');
      }
    }
  } catch (err) {
    console.error('Failed to push to Google Sheet:', err.message);
  }
}

async function main() {
  const opts = parseArgs();

  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: path.join(__dirname, 'chrome-data'),
    defaultViewport: null,
    args: ['--window-size=1280,900', '--no-restore-session-state'],
  });

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  for (const p of pages.slice(1)) {
    await p.close();
  }

  try {
    await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  } catch {
    console.log('Page load timed out — continuing anyway (login page may still be loading).');
  }

  await waitForLogin(page);

  // Wait for jQuery and tree to be fully ready, retrying through navigations
  while (true) {
    try {
      await page.waitForFunction(
        () => typeof jQuery !== 'undefined' && jQuery('#tree').length > 0,
        { timeout: 30000 }
      );
      break;
    } catch {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  await new Promise(r => setTimeout(r, 2000));

  await expandFolders(page, opts.folders);
  const csv = await extractCSV(page, opts.folders);

  const outputPath = path.resolve(opts.output);
  fs.writeFileSync(outputPath, csv, 'utf-8');

  const rowCount = csv.split('\n').length - 1;
  console.log(`Wrote ${rowCount} rows to ${outputPath}`);

  if (config.googleSheetWebAppUrl) {
    await pushToGoogleSheet(csv);
  }

  if (opts.keepOpen) {
    console.log('Browser left open (--keep-open). Press Ctrl+C to exit.');
  } else {
    await browser.close();
    console.log('Done.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});

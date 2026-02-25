const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
const DEFAULT_FOLDERS = config.folders;
const TARGET_URL = config.loginUrl;
const COOKIES_PATH = path.join(__dirname, 'cookies.json');

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

async function saveCookies(page) {
  const client = await page.createCDPSession();
  const { cookies } = await client.send('Network.getAllCookies');
  await client.detach();
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2), 'utf-8');
  return cookies.length;
}

async function restoreCookies(page) {
  let cookies;
  try {
    cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
  } catch {
    return 0;
  }
  if (!cookies || cookies.length === 0) return 0;

  const client = await page.createCDPSession();
  await client.send('Network.setCookies', { cookies });
  await client.detach();
  return cookies.length;
}

function killOrphanChromeProcesses() {
  try {
    const output = execSync(
      'pgrep -f "Google Chrome.*--remote-debugging" 2>/dev/null || true',
      { encoding: 'utf-8' }
    ).trim();
    if (!output) return;
    const pids = output.split('\n').filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGTERM');
      } catch {}
    }
    if (pids.length > 0) {
      console.log(`Killed ${pids.length} orphan Chrome process(es) from previous runs.`);
    }
  } catch {}
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

  killOrphanChromeProcesses();

  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: false,
    channel: 'chrome',
    defaultViewport: null,
    args: [
      '--window-size=1280,900',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-extensions',
      '--disable-component-update',
      '--disable-domain-reliability',
    ],
  });

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  for (const p of pages.slice(1)) {
    await p.close();
  }

  const restoredCount = await restoreCookies(page);
  if (restoredCount > 0) {
    console.log(`Restored ${restoredCount} saved cookies from previous session.`);
  }

  try {
    await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 30000 });
  } catch {
    console.log('Page load timed out — continuing anyway (login page may still be loading).');
  }

  await waitForLogin(page);

  const savedCount = await saveCookies(page);
  console.log(`Saved ${savedCount} cookies for next session.`);

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

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

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

async function waitForLogin(page, browser) {
  const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
  const POLL_INTERVAL_MS = 3000;
  const startTime = Date.now();

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
    if (!browser.connected) {
      throw new Error('Browser was closed during login wait.');
    }
    if (Date.now() - startTime > LOGIN_TIMEOUT_MS) {
      throw new Error('Login timed out after 10 minutes.');
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const found = await page.$('#tree');
      if (found) {
        console.log('Login detected. Tree found.');
        return;
      }
    } catch (err) {
      if (!browser.connected) {
        throw new Error('Browser was closed during login wait.');
      }
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

    // ERISA § → 29 USC § conversion offsets by Title I part range
    const ERISA_TO_USC = [
      [2, 4, 999],       // Title I, Subtitle A → 29 USC 1001-1003
      [101, 199, 920],   // Part 1 (Reporting & Disclosure) → 1021+
      [201, 299, 850],   // Part 2 (Participation & Vesting) → 1051+
      [301, 399, 780],   // Part 3 (Funding) → 1081+
      [401, 499, 700],   // Part 4 (Fiduciary) → 1101+
      [501, 599, 630],   // Part 5 (Administration) → 1131+
      [601, 699, 560],   // Part 6 (COBRA) → 1161+
      [701, 799, 480],   // Part 7 (Health) → 1181+
      [3001, 3099, -1800], // Title III → 1201+
    ];

    // Part 8 uses letter suffixes (§1193, §1193a, §1193b, §1193c)
    const ERISA_PART8 = { '801': '1193', '802': '1193a', '803': '1193b', '804': '1193c' };

    function buildSourceUrl(source, id) {
      if (!source || !id) return '';

      if (source === 'IRSStatutes') {
        return 'https://www.law.cornell.edu/uscode/text/26/' + id;
      }
      if (source === 'IRSRegs') {
        return 'https://www.law.cornell.edu/cfr/text/26/' + id;
      }
      if (source === 'DOLRegs') {
        return 'https://www.law.cornell.edu/cfr/text/29/' + id;
      }
      if (source === 'DOLStatutes') {
        if (ERISA_PART8[id]) {
          return 'https://www.law.cornell.edu/uscode/text/29/' + ERISA_PART8[id];
        }

        const match = id.match(/^(\d+)([a-zA-Z]*)$/);
        if (!match) return '';

        const num = parseInt(match[1]);
        const suffix = match[2] || '';

        for (const [min, max, offset] of ERISA_TO_USC) {
          if (num >= min && num <= max) {
            return 'https://www.law.cornell.edu/uscode/text/29/' + (num + offset) + suffix;
          }
        }

        // Outside known ERISA ranges (e.g. 1001a, 1143a) — already a USC number
        return 'https://www.law.cornell.edu/uscode/text/29/' + id;
      }

      return '';
    }

    let maxDepth = 0;
    function measureDepth(node, depth) {
      const d = depth + 1;
      if (!node.children || node.children.length === 0) {
        if (d > maxDepth) maxDepth = d;
      } else {
        node.children.forEach(child => measureDepth(child, d));
      }
    }

    tree.visit(node => {
      if (targets.includes(node.title.trim())) {
        measureDepth(node, 0);
      }
    });

    if (maxDepth === 0) maxDepth = 1;
    const header = Array.from({ length: maxDepth }, (_, i) => `Level ${i + 1}`);
    header.push('Source URL');
    const rows = [header];

    function walk(node, ancestors) {
      const nodePath = ancestors.concat(node.title);
      if (!node.children || node.children.length === 0) {
        const row = [];
        for (let i = 0; i < maxDepth; i++) {
          row.push(nodePath[i] || '');
        }
        const source = node.data ? node.data.Source : '';
        const id = node.data ? node.data.ID : '';
        row.push(buildSourceUrl(source, id));
        rows.push(row);
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
  let browser;

  console.log('Launching browser...');
  browser = await puppeteer.launch({
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

  browser.on('disconnected', () => {
    console.log('Browser disconnected.');
  });

  try {
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

    await waitForLogin(page, browser);

    const savedCount = await saveCookies(page);
    console.log(`Saved ${savedCount} cookies for next session.`);

    const MAX_JQUERY_RETRIES = 10;
    for (let attempt = 1; attempt <= MAX_JQUERY_RETRIES; attempt++) {
      if (!browser.connected) {
        throw new Error('Browser was closed while waiting for jQuery.');
      }
      try {
        await page.waitForFunction(
          () => typeof jQuery !== 'undefined' && jQuery('#tree').length > 0,
          { timeout: 30000 }
        );
        break;
      } catch {
        if (!browser.connected) {
          throw new Error('Browser was closed while waiting for jQuery.');
        }
        if (attempt === MAX_JQUERY_RETRIES) {
          throw new Error(`jQuery/#tree not available after ${MAX_JQUERY_RETRIES} retries.`);
        }
        console.log(`jQuery not ready yet (attempt ${attempt}/${MAX_JQUERY_RETRIES}), retrying...`);
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
      browser = null;
      console.log('Done.');
    }
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});

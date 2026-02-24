fetch(chrome.runtime.getURL('config.json'))
  .then(r => r.json())
  .then(config => {
    const container = document.getElementById('folderList');
    config.folders.forEach(folder => {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = folder;
      cb.checked = true;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + folder));
      container.appendChild(label);
    });
  });

function getSelectedFolders() {
  return Array.from(document.querySelectorAll('input[type="checkbox"]:checked'))
    .map(cb => cb.value);
}

function setStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = type || '';
}

document.getElementById('expandBtn').addEventListener('click', async () => {
  const targets = getSelectedFolders();
  if (targets.length === 0) {
    setStatus('Select at least one folder.', 'error');
    return;
  }

  setStatus('Expanding folders...', 'working');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [targets],
    func: async (targets) => {
      const tree = $("#tree").fancytree("getTree");
      if (!tree) return { error: 'Fancytree not found on this page.' };

      async function expandNode(node) {
        if (!node.isExpanded() && (node.hasChildren() || node.lazy)) {
          try {
            await node.setExpanded(true);
          } catch (e) {}
          await new Promise(r => setTimeout(r, 300));
        }
        if (node.children) {
          for (const child of node.children) {
            await expandNode(child);
          }
        }
      }

      const rootNodes = [];
      tree.visit(function(node) {
        if (targets.includes(node.title.trim())) {
          rootNodes.push(node);
        }
      });

      for (const node of rootNodes) {
        await expandNode(node);
      }

      return { expanded: rootNodes.length };
    }
  }, (results) => {
    if (chrome.runtime.lastError) {
      setStatus('Error: ' + chrome.runtime.lastError.message, 'error');
      return;
    }
    const result = results?.[0]?.result;
    if (result?.error) {
      setStatus(result.error, 'error');
    } else {
      setStatus(`Expanding ${result?.expanded || 0} root folders. Wait a few seconds, then click Step 2.`, 'success');
    }
  });
});

document.getElementById('extractBtn').addEventListener('click', async () => {
  const targets = getSelectedFolders();
  if (targets.length === 0) {
    setStatus('Select at least one folder.', 'error');
    return;
  }

  setStatus('Extracting tree...', 'working');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [targets],
    func: (targets) => {
      const tree = $("#tree").fancytree("getTree");
      if (!tree) return { error: 'Fancytree not found on this page.' };

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
        const path = ancestors.concat(node.title);
        if (!node.children || node.children.length === 0) {
          const row = [path[0] || '', path[1] || '', path[2] || ''];
          rows.push(row);
        } else {
          node.children.forEach(child => walk(child, path));
        }
      }

      tree.visit(function(node) {
        if (targets.includes(node.title.trim())) {
          walk(node, []);
        }
      });

      const text = rows.map(r => r.map(csvEscape).join(',')).join('\n');

      return navigator.clipboard.writeText(text).then(() => {
        return { count: rows.length - 1 };
      }).catch(() => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return { count: rows.length - 1 };
      });
    }
  }, (results) => {
    if (chrome.runtime.lastError) {
      setStatus('Error: ' + chrome.runtime.lastError.message, 'error');
      return;
    }
    const result = results?.[0]?.result;
    if (result?.error) {
      setStatus(result.error, 'error');
    } else {
      setStatus(`Copied ${result?.count} rows of CSV to clipboard!`, 'success');
    }
  });
});

// Tiny DOM helpers so screens read cleanly without a framework.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2), v);
    } else if (v !== null && v !== undefined) {
      node.setAttribute(k, v);
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// Downloads text as a file. Share strings with an embedded graphic or
// a big scan count are too long for a Signal or SMS message, but ride
// along fine as an attachment.
export function saveTextFile(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Opens a file picker and resolves with the chosen file's text, or
// null if the picker closes without a choice being observed.
export function openTextFile(accept) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept: accept || '.txt,text/plain' });
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.remove();
      resolve(file ? await file.text() : null);
    });
    document.body.append(input);
    input.click();
  });
}

export async function copyText(text, feedbackBtn) {
  try {
    await navigator.clipboard.writeText(text);
    if (feedbackBtn) {
      const old = feedbackBtn.textContent;
      feedbackBtn.textContent = 'Copied';
      setTimeout(() => { feedbackBtn.textContent = old; }, 1200);
    }
    return true;
  } catch {
    return false;
  }
}

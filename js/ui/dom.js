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

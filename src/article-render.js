'use strict';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const MEDIA_RE = /^\[(عکس|ویدیو|نقل)\s*:\s*([\s\S]+)\]$/;
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

function aparatIdOf(raw) {
  const s = String(raw || '').trim();
  const pats = [
    /aparat\.com\/v\/([A-Za-z0-9]+)/i,
    /aparat\.com\/video\/video\/embed\/videohash\/([A-Za-z0-9]+)/i,
    /^aparat\/([A-Za-z0-9]+)$/i,
    /^([A-Za-z0-9]{5,20})$/
  ];
  for (const re of pats) { const m = s.match(re); if (m) return m[1]; }
  return null;
}

function renderMedia(line) {
  const m = line.match(MEDIA_RE);
  if (!m) return null;

  const kind = m[1];
  const parts = m[2].split('|').map(x => x.trim());
  const value = parts[0];
  const caption = parts.slice(1).join(' | ').trim();

  if (kind === 'نقل') {
    const t = m[2].trim();
    return t ? `<blockquote><p>${esc(t)}</p></blockquote>` : null;
  }

  if (kind === 'عکس') {
    if (!SAFE_FILE.test(value)) return null;
    const file = /\.(jpe?g|png|webp|gif)$/i.test(value) ? value : value + '.jpg';
    const primary = `/images/journal/${file}`;
    const fallback = `/images/products/${file}`;
    const cap = caption ? `<figcaption>${esc(caption)}</figcaption>` : '';
    return `<figure>`
      + `<img src="${primary}" alt="${esc(caption || 'تصویر مقاله')}"`
      + ` loading="lazy" decoding="async"`
      + ` onerror="if(!this.dataset.alt){this.dataset.alt=1;this.src='${fallback}'}`
      + `else{this.closest('figure').remove()}">`
      + `${cap}</figure>`;
  }

  if (kind === 'ویدیو') {
    const id = aparatIdOf(value);
    if (!id) return null;
    const cap = caption ? `<figcaption>${esc(caption)}</figcaption>` : '';
    return `<figure class="embed-wrap">`
      + `<div class="embed"><iframe src="https://www.aparat.com/video/video/embed/videohash/${id}/vt/frame"`
      + ` title="${esc(caption || 'ویدیوی آموزشی')}" loading="lazy"`
      + ` allowfullscreen webkitallowfullscreen mozallowfullscreen></iframe></div>`
      + `${cap}</figure>`;
  }
  return null;
}

function isHeading(line) {
  if (line.length > 70) return false;
  if (line.endsWith('؟')) return true;
  return line.length <= 40 && !/[.!،؛:]$/.test(line);
}

function renderArticle(text) {
  const blocks = String(text || '').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);

  return blocks.map(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);

    if (lines.every(l => MEDIA_RE.test(l))) {
      return lines.map(renderMedia).filter(Boolean).join('');
    }
    if (lines.length > 1 && isHeading(lines[0])) {
      return `<h2>${esc(lines[0])}</h2>` + `<p>${esc(lines.slice(1).join(' '))}</p>`;
    }
    if (lines.length === 1 && isHeading(lines[0])) {
      return `<h2>${esc(lines[0])}</h2>`;
    }
    return `<p>${esc(lines.join(' '))}</p>`;
  }).join('');
}

module.exports = { renderArticle, renderMedia, isHeading, aparatIdOf, esc };

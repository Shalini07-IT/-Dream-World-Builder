/* =========================================
   DREAM WORLD BUILDER — script.js
   ========================================= */

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  nodes: [],          // { id, type, name, desc, color, icon, x, y }
  relationships: [],  // { id, from, to, label, style }
  events: [],         // { id, title, desc, time, color }
};

let mapTransform = { x: 0, y: 0, scale: 1 };
let isPanning = false, panStart = { x: 0, y: 0 };
let draggingNode = null, dragOffset = { x: 0, y: 0 };
let connectMode = false;
let connectFirst = null;
let pendingConnection = null;

const uid = () => Math.random().toString(36).slice(2, 9);

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}

// ── DOM Refs ───────────────────────────────────────────────────────────────
const mapContainer   = document.getElementById('map-container');
const mapWorld       = document.getElementById('map-world');
const svgEl          = document.getElementById('connections-svg');
const mapHint        = document.getElementById('map-hint');
const connectBanner  = document.getElementById('connect-mode-banner');
const modalOverlay   = document.getElementById('modal-overlay');
const toastEl        = document.getElementById('toast');
const rippleEl       = document.getElementById('ripple-container');

// ── Starfield Canvas ───────────────────────────────────────────────────────
(function initStarfield() {
  const canvas = document.getElementById('starfield');
  const ctx = canvas.getContext('2d');
  let stars = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    stars = Array.from({length: 180}, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.6 + 0.3,
      alpha: Math.random(),
      speed: Math.random() * 0.004 + 0.001,
      twinkleOffset: Math.random() * Math.PI * 2,
    }));
  }

  function draw(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    stars.forEach(s => {
      const alpha = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t * s.speed * 60 + s.twinkleOffset));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(draw);
})();

// ── Floating Particles ─────────────────────────────────────────────────────
(function initParticles() {
  const container = document.getElementById('particles');
  const colors = ['#8b5cf6','#06b6d4','#ec4899','#f59e0b'];

  for (let i = 0; i < 30; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 5 + 2;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const left = Math.random() * 100;
    const duration = 12 + Math.random() * 20;
    const delay = Math.random() * 15;
    p.style.cssText = `
      width:${size}px; height:${size}px;
      background:${color};
      left:${left}%;
      bottom:-10px;
      animation-duration:${duration}s;
      animation-delay:-${delay}s;
      opacity:${0.3 + Math.random() * 0.5};
      box-shadow: 0 0 ${size*2}px ${color};
    `;
    container.appendChild(p);
  }
})();

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, duration = 2500) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

// ── Ripple ─────────────────────────────────────────────────────────────────
function createRipple(x, y) {
  const d = document.createElement('div');
  d.className = 'ripple';
  const size = 40;
  d.style.cssText = `
    width:${size}px; height:${size}px;
    left:${x - size/2}px; top:${y - size/2}px;
  `;
  rippleEl.appendChild(d);
  setTimeout(() => d.remove(), 800);
}

// ── Map Transform ──────────────────────────────────────────────────────────
function applyTransform() {
  mapWorld.style.transform = `translate(${mapTransform.x}px, ${mapTransform.y}px) scale(${mapTransform.scale})`;
  // SVG must match world transform
  svgEl.style.transform = mapWorld.style.transform;
  updateConnections();
}

function clampScale(s) { return Math.min(3, Math.max(0.2, s)); }

document.getElementById('zoom-in').addEventListener('click', () => {
  mapTransform.scale = clampScale(mapTransform.scale * 1.2);
  applyTransform();
});
document.getElementById('zoom-out').addEventListener('click', () => {
  mapTransform.scale = clampScale(mapTransform.scale / 1.2);
  applyTransform();
});
document.getElementById('zoom-reset').addEventListener('click', () => {
  mapTransform = { x: 0, y: 0, scale: 1 };
  applyTransform();
});

// Wheel zoom
mapContainer.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  mapTransform.scale = clampScale(mapTransform.scale * delta);
  applyTransform();
}, { passive: false });

// ── Pan ───────────────────────────────────────────────────────────────────
mapContainer.addEventListener('mousedown', (e) => {
  if (e.target === mapContainer || e.target === mapWorld || e.target.classList.contains('map-grid')) {
    if (!connectMode) {
      isPanning = true;
      panStart = { x: e.clientX - mapTransform.x, y: e.clientY - mapTransform.y };
      mapContainer.classList.add('grabbing');
    }
  }
});

window.addEventListener('mousemove', (e) => {
  if (isPanning) {
    mapTransform.x = e.clientX - panStart.x;
    mapTransform.y = e.clientY - panStart.y;
    applyTransform();
  }
  if (draggingNode) {
    const rect = mapContainer.getBoundingClientRect();
    const wx = (e.clientX - rect.left - mapTransform.x) / mapTransform.scale;
    const wy = (e.clientY - rect.top - mapTransform.y) / mapTransform.scale;
    draggingNode.x = wx - dragOffset.x;
    draggingNode.y = wy - dragOffset.y;
    const el = document.querySelector(`[data-id="${draggingNode.id}"]`);
    if (el) {
      el.style.left = draggingNode.x + 'px';
      el.style.top = draggingNode.y + 'px';
    }
    updateConnections();
  }
});

window.addEventListener('mouseup', () => {
  isPanning = false;
  mapContainer.classList.remove('grabbing');
  if (draggingNode) {
    draggingNode = null;
    saveToStorage();
  }
});

// Map click (create ripple, hide hint)
mapContainer.addEventListener('click', (e) => {
  createRipple(e.clientX, e.clientY);
  if (state.nodes.length > 0) mapHint.style.opacity = '0';
});

// ── Node Creation ──────────────────────────────────────────────────────────
function createNodeElement(node) {
  const el = document.createElement('div');
  el.className = 'map-node';
  el.dataset.id = node.id;
  el.style.left = node.x + 'px';
  el.style.top = node.y + 'px';
  el.style.setProperty('--node-color', node.color);
  el.style.setProperty('--node-rgb', hexToRgb(node.color));

  el.innerHTML = `
    <div class="node-inner">
      <span class="node-icon">${node.icon}</span>
      <span class="node-label">${escHtml(node.name)}</span>
      <span class="node-type-badge">${node.type}</span>
    </div>
    <button class="node-delete" title="Delete">✕</button>
  `;

  // Drag
  el.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('node-delete')) return;
    e.stopPropagation();

    if (connectMode) {
      handleConnectClick(node);
      return;
    }

    draggingNode = node;
    el.classList.add('dragging');
    const rect = mapContainer.getBoundingClientRect();
    const wx = (e.clientX - rect.left - mapTransform.x) / mapTransform.scale;
    const wy = (e.clientY - rect.top - mapTransform.y) / mapTransform.scale;
    dragOffset = { x: wx - node.x, y: wy - node.y };
  });

  el.addEventListener('mouseup', () => el.classList.remove('dragging'));

  // Delete
  el.querySelector('.node-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteNode(node.id);
  });

  mapWorld.appendChild(el);
}

function addNodeAtCenter(node) {
  // Place in visible center
  const rect = mapContainer.getBoundingClientRect();
  node.x = (rect.width / 2 - mapTransform.x) / mapTransform.scale + (Math.random() - 0.5) * 100;
  node.y = (rect.height / 2 - mapTransform.y) / mapTransform.scale + (Math.random() - 0.5) * 100;
  state.nodes.push(node);
  createNodeElement(node);
  mapHint.style.opacity = '0';
  saveToStorage();
}

function deleteNode(id) {
  state.nodes = state.nodes.filter(n => n.id !== id);
  state.relationships = state.relationships.filter(r => r.from !== id && r.to !== id);
  document.querySelector(`[data-id="${id}"]`)?.remove();
  updateConnections();
  renderPanel();
  saveToStorage();
  showToast('Node removed from the dream');
}

// ── Connect Mode ───────────────────────────────────────────────────────────
document.getElementById('btn-connect-mode').addEventListener('click', () => {
  connectMode = !connectMode;
  connectFirst = null;
  document.getElementById('btn-connect-mode').classList.toggle('active', connectMode);
  connectBanner.classList.toggle('visible', connectMode);
  mapContainer.classList.toggle('connecting', connectMode);
});

document.getElementById('cancel-connect').addEventListener('click', () => {
  exitConnectMode();
});

function exitConnectMode() {
  connectMode = false;
  connectFirst = null;
  document.getElementById('btn-connect-mode').classList.remove('active');
  connectBanner.classList.remove('visible');
  mapContainer.classList.remove('connecting');
  // Remove selected class
  document.querySelectorAll('.map-node.connect-selected').forEach(el => el.classList.remove('connect-selected'));
}

function handleConnectClick(node) {
  if (!connectFirst) {
    connectFirst = node;
    document.querySelector(`[data-id="${node.id}"]`)?.classList.add('connect-selected');
    showToast(`Selected: ${node.name} — now click a second node`);
  } else {
    if (connectFirst.id === node.id) {
      showToast('Select a different node');
      return;
    }
    pendingConnection = { from: connectFirst, to: node };
    showConnectModal(connectFirst, node);
    exitConnectMode();
  }
}

// ── SVG Connections ────────────────────────────────────────────────────────
function updateConnections() {
  svgEl.innerHTML = '';

  state.relationships.forEach(rel => {
    const fromNode = state.nodes.find(n => n.id === rel.from);
    const toNode   = state.nodes.find(n => n.id === rel.to);
    if (!fromNode || !toNode) return;

    const x1 = fromNode.x * mapTransform.scale + mapTransform.x;
    const y1 = fromNode.y * mapTransform.scale + mapTransform.y;
    const x2 = toNode.x * mapTransform.scale + mapTransform.x;
    const y2 = toNode.y * mapTransform.scale + mapTransform.y;

    // Cubic bezier control points
    const dx = x2 - x1, dy = y2 - y1;
    const cx1 = x1 + dx * 0.3, cy1 = y1 + dy * 0.8;
    const cx2 = x2 - dx * 0.3, cy2 = y2 - dy * 0.8;
    const d = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;

    const color = fromNode.color;
    const dashArr = rel.style === 'dashed' ? '10 6' : rel.style === 'dotted' ? '3 5' : '8 4';

    const group = document.createElementNS('http://www.w3.org/2000/svg','g');
    group.dataset.relId = rel.id;

    const pathBg = document.createElementNS('http://www.w3.org/2000/svg','path');
    pathBg.setAttribute('d', d);
    pathBg.setAttribute('class','conn-path-bg');
    pathBg.setAttribute('stroke', color);

    const pathGlow = document.createElementNS('http://www.w3.org/2000/svg','path');
    pathGlow.setAttribute('d', d);
    pathGlow.setAttribute('class','conn-glow');
    pathGlow.setAttribute('stroke', color);
    pathGlow.style.strokeDasharray = dashArr;

    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d', d);
    path.setAttribute('class','conn-path');
    path.setAttribute('stroke', color);
    path.style.strokeDasharray = dashArr;

    // Midpoint label
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    const labelGroup = document.createElementNS('http://www.w3.org/2000/svg','g');
    labelGroup.setAttribute('class','conn-label-group');

    const labelBg = document.createElementNS('http://www.w3.org/2000/svg','rect');
    const label = rel.label || '';
    labelBg.setAttribute('x', midX - label.length * 3.2 - 6);
    labelBg.setAttribute('y', midY - 9);
    labelBg.setAttribute('width', label.length * 6.4 + 12);
    labelBg.setAttribute('height', 16);
    labelBg.setAttribute('rx', 6);
    labelBg.setAttribute('fill', 'rgba(15,23,42,0.75)');
    labelBg.setAttribute('stroke', color);
    labelBg.setAttribute('stroke-width', '1');
    labelBg.setAttribute('stroke-opacity', '0.4');

    const labelText = document.createElementNS('http://www.w3.org/2000/svg','text');
    labelText.setAttribute('x', midX);
    labelText.setAttribute('y', midY + 1);
    labelText.setAttribute('text-anchor','middle');
    labelText.setAttribute('dominant-baseline','middle');
    labelText.textContent = label;

    labelGroup.appendChild(labelBg);
    labelGroup.appendChild(labelText);

    group.appendChild(pathBg);
    group.appendChild(pathGlow);
    group.appendChild(path);
    group.appendChild(labelGroup);

    svgEl.appendChild(group);
  });
}

// ── Tab Switching ──────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ── Panel Render ───────────────────────────────────────────────────────────
function renderPanel() {
  renderCharacters();
  renderRelationships();
  renderTimeline();
}

function renderCharacters() {
  const list = document.getElementById('character-list');
  document.getElementById('char-count').textContent = state.nodes.length;
  if (state.nodes.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">◈</div><p>No characters yet.<br/>Add one to begin.</p></div>`;
    return;
  }
  list.innerHTML = state.nodes.map(n => `
    <div class="panel-card" style="--card-color:${n.color}">
      <div class="card-row">
        <div class="card-avatar" style="background:${n.color}22; border-color:${n.color}">${n.icon}</div>
        <div class="card-name">${escHtml(n.name)}</div>
      </div>
      ${n.desc ? `<div class="card-desc">${escHtml(n.desc)}</div>` : ''}
      <div class="card-meta"><span>${n.type}</span></div>
      <button class="card-delete" data-id="${n.id}">✕</button>
    </div>
  `).join('');
  list.querySelectorAll('.card-delete').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteNode(btn.dataset.id); });
  });
}

function renderRelationships() {
  const list = document.getElementById('relationship-list');
  document.getElementById('rel-count').textContent = state.relationships.length;
  if (state.relationships.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">⤳</div><p>No connections yet.<br/>Use Connect Mode to link nodes.</p></div>`;
    return;
  }
  list.innerHTML = state.relationships.map(rel => {
    const from = state.nodes.find(n => n.id === rel.from);
    const to   = state.nodes.find(n => n.id === rel.to);
    return `
      <div class="rel-card">
        <div class="rel-endpoints">
          <div class="rel-endpoint"><strong>${from ? escHtml(from.name) : '?'}</strong></div>
          <div class="rel-label-badge">${escHtml(rel.label || 'connected')}</div>
          <div class="rel-endpoint"><strong>${to ? escHtml(to.name) : '?'}</strong></div>
        </div>
        <button class="rel-delete" data-id="${rel.id}">✕</button>
      </div>
    `;
  }).join('');
  list.querySelectorAll('.rel-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      state.relationships = state.relationships.filter(r => r.id !== btn.dataset.id);
      updateConnections();
      renderPanel();
      saveToStorage();
      showToast('Connection severed');
    });
  });
}

function renderTimeline() {
  const list = document.getElementById('timeline-list');
  document.getElementById('event-count').textContent = state.events.length;
  if (state.events.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">◆</div><p>No events yet.<br/>Add a story event to begin.</p></div>`;
    return;
  }
  list.innerHTML = state.events.map(ev => `
    <div class="timeline-card" style="--evt-color:${ev.color}">
      <div class="timeline-dot"></div>
      ${ev.time ? `<div class="timeline-time">${escHtml(ev.time)}</div>` : ''}
      <div class="timeline-title">${escHtml(ev.title)}</div>
      ${ev.desc ? `<div class="timeline-desc">${escHtml(ev.desc)}</div>` : ''}
      <button class="timeline-delete" data-id="${ev.id}">✕</button>
    </div>
  `).join('');
  list.querySelectorAll('.timeline-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      state.events = state.events.filter(e => e.id !== btn.dataset.id);
      renderTimeline();
      saveToStorage();
      showToast('Event removed from timeline');
    });
  });
}

// ── Modals ─────────────────────────────────────────────────────────────────
function openModal(id) {
  modalOverlay.classList.add('visible');
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function closeModal() {
  modalOverlay.classList.remove('visible');
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
  pendingConnection = null;
}

modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

// Color presets
document.querySelectorAll('.color-presets').forEach(group => {
  group.querySelectorAll('.preset').forEach(p => {
    p.addEventListener('click', () => {
      const forAttr = group.dataset.for;
      const inputId = forAttr ? `${forAttr}-color` : 'loc-color';
      document.getElementById(inputId).value = p.dataset.color;
    });
  });
});

// Fix: loc presets don't have data-for
document.querySelector('#modal-location .color-presets').querySelectorAll('.preset').forEach(p => {
  p.addEventListener('click', () => {
    document.getElementById('loc-color').value = p.dataset.color;
  });
});

// Icon pickers
function setupIconPicker(pickerId) {
  const picker = document.getElementById(pickerId);
  picker.querySelectorAll('.icon-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      picker.querySelectorAll('.icon-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
    });
  });
}
setupIconPicker('loc-icon-picker');
setupIconPicker('char-icon-picker');

// Add Location
document.getElementById('btn-add-location').addEventListener('click', () => {
  document.getElementById('loc-name').value = '';
  document.getElementById('loc-desc').value = '';
  document.getElementById('loc-color').value = '#8b5cf6';
  document.querySelector('#loc-icon-picker .icon-opt.selected')?.classList.remove('selected');
  document.querySelector('#loc-icon-picker .icon-opt:first-child').classList.add('selected');
  openModal('modal-location');
  setTimeout(() => document.getElementById('loc-name').focus(), 100);
});

document.getElementById('loc-cancel').addEventListener('click', closeModal);
document.getElementById('loc-confirm').addEventListener('click', () => {
  const name = document.getElementById('loc-name').value.trim();
  if (!name) { document.getElementById('loc-name').focus(); return; }
  const node = {
    id: uid(), type: 'location',
    name,
    desc: document.getElementById('loc-desc').value.trim(),
    color: document.getElementById('loc-color').value,
    icon: document.querySelector('#loc-icon-picker .icon-opt.selected')?.dataset.icon || '⬡',
    x: 0, y: 0,
  };
  addNodeAtCenter(node);
  renderPanel();
  closeModal();
  showToast(`✦ "${name}" added to the dream map`);
});

// Add Character
document.getElementById('btn-add-character').addEventListener('click', () => {
  document.getElementById('char-name').value = '';
  document.getElementById('char-desc').value = '';
  document.getElementById('char-color').value = '#ec4899';
  document.querySelector('#char-icon-picker .icon-opt.selected')?.classList.remove('selected');
  document.querySelector('#char-icon-picker .icon-opt:first-child').classList.add('selected');
  openModal('modal-character');
  setTimeout(() => document.getElementById('char-name').focus(), 100);
});

document.getElementById('char-cancel').addEventListener('click', closeModal);
document.getElementById('char-confirm').addEventListener('click', () => {
  const name = document.getElementById('char-name').value.trim();
  if (!name) { document.getElementById('char-name').focus(); return; }
  const node = {
    id: uid(), type: 'character',
    name,
    desc: document.getElementById('char-desc').value.trim(),
    color: document.getElementById('char-color').value,
    icon: document.querySelector('#char-icon-picker .icon-opt.selected')?.dataset.icon || '◈',
    x: 0, y: 0,
  };
  addNodeAtCenter(node);
  renderPanel();
  closeModal();
  showToast(`◈ "${name}" entered the dreamscape`);
});

// Add Event
document.getElementById('btn-add-event').addEventListener('click', () => {
  document.getElementById('evt-title').value = '';
  document.getElementById('evt-desc').value = '';
  document.getElementById('evt-time').value = '';
  document.getElementById('evt-color').value = '#06b6d4';
  openModal('modal-event');
  setTimeout(() => document.getElementById('evt-title').focus(), 100);
});

document.getElementById('evt-cancel').addEventListener('click', closeModal);
document.getElementById('evt-confirm').addEventListener('click', () => {
  const title = document.getElementById('evt-title').value.trim();
  if (!title) { document.getElementById('evt-title').focus(); return; }
  const ev = {
    id: uid(),
    title,
    desc: document.getElementById('evt-desc').value.trim(),
    time: document.getElementById('evt-time').value.trim(),
    color: document.getElementById('evt-color').value,
  };
  state.events.push(ev);
  renderTimeline();
  // Switch to timeline tab
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('[data-tab="timeline"]').classList.add('active');
  document.getElementById('tab-timeline').classList.add('active');
  closeModal();
  saveToStorage();
  showToast(`◆ "${title}" woven into the story`);
});

// Connect Modal
function showConnectModal(from, to) {
  document.getElementById('connect-preview').innerHTML =
    `<span style="color:${from.color}">${from.icon} ${escHtml(from.name)}</span>
     &nbsp;⤳&nbsp;
     <span style="color:${to.color}">${to.icon} ${escHtml(to.name)}</span>`;
  document.getElementById('rel-label').value = '';
  document.querySelector('input[name="rel-style"][value="solid"]').checked = true;
  openModal('modal-connect');
  setTimeout(() => document.getElementById('rel-label').focus(), 100);
}

document.getElementById('rel-cancel').addEventListener('click', closeModal);
document.getElementById('rel-confirm').addEventListener('click', () => {
  if (!pendingConnection) return;
  const label = document.getElementById('rel-label').value.trim();
  const style = document.querySelector('input[name="rel-style"]:checked').value;
  const rel = {
    id: uid(),
    from: pendingConnection.from.id,
    to: pendingConnection.to.id,
    label, style,
  };
  state.relationships.push(rel);
  updateConnections();
  renderRelationships();
  // Switch to relationships tab
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('[data-tab="relationships"]').classList.add('active');
  document.getElementById('tab-relationships').classList.add('active');
  closeModal();
  saveToStorage();
  showToast('⤳ Connection forged in the dream');
});

// ── Save / Clear ───────────────────────────────────────────────────────────
function saveToStorage() {
  localStorage.setItem('dreamworld', JSON.stringify({ state, mapTransform }));
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem('dreamworld');
    if (!raw) return;
    const { state: s, mapTransform: mt } = JSON.parse(raw);
    if (s) {
      state.nodes = s.nodes || [];
      state.relationships = s.relationships || [];
      state.events = s.events || [];
    }
    if (mt) Object.assign(mapTransform, mt);
    // Re-render nodes
    state.nodes.forEach(n => createNodeElement(n));
    applyTransform();
    renderPanel();
    if (state.nodes.length > 0) mapHint.style.opacity = '0';
  } catch(e) {
    console.warn('Failed to load dream world:', e);
  }
}

document.getElementById('btn-save').addEventListener('click', () => {
  saveToStorage();
  showToast('✦ Dream world saved');
});

document.getElementById('btn-clear').addEventListener('click', () => {
  if (!confirm('Clear the entire dream world? This cannot be undone.')) return;
  state.nodes = [];
  state.relationships = [];
  state.events = [];
  mapWorld.querySelectorAll('.map-node').forEach(n => n.remove());
  updateConnections();
  renderPanel();
  mapTransform = { x: 0, y: 0, scale: 1 };
  applyTransform();
  mapHint.style.opacity = '1';
  saveToStorage();
  showToast('Dream world cleared');
});

// ── Keyboard shortcuts ─────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (connectMode) exitConnectMode();
    else closeModal();
  }
  if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
    const activeModal = document.querySelector('.modal.active');
    if (activeModal) {
      const confirm = activeModal.querySelector('[id$="-confirm"]');
      confirm?.click();
    }
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── Init ───────────────────────────────────────────────────────────────────
loadFromStorage();
applyTransform();

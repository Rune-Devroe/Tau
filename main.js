const ROLE_CLASS = {
  HQ: 'role-hq', Troops: 'role-troops', Elite: 'role-elite',
  'Fast Attack': 'role-fast', 'Heavy Support': 'role-heavy'
};
const ROLE_COLOR = {
  HQ: '#e8c06a', Troops: '#6ec6e8', Elite: '#c084fc',
  'Fast Attack': '#86efac', 'Heavy Support': '#f87171'
};

// ── localStorage helpers ──────────────────────────────────────────────────────
const STORAGE_KEY = 'tau_empire_units';
const STORAGE_ID_KEY = 'tau_empire_next_id';

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(units));
    localStorage.setItem(STORAGE_ID_KEY, String(nextId));
  } catch(e) { console.warn('localStorage vol of niet beschikbaar:', e); }
}

let units = loadFromStorage() || [];
let nextId = parseInt(localStorage.getItem(STORAGE_ID_KEY) || '10');
let editId = null;

// ── BattleScribe / NewRecruit JSON parser ─────────────────────────────────────
const CATEGORY_ROLE_MAP = {
  'hq': 'HQ', 'commander': 'HQ', 'character': 'HQ', 'epic hero': 'HQ',
  'battleline': 'Troops', 'troops': 'Troops',
  'elite': 'Elite',
  'fast attack': 'Fast Attack',
  'heavy support': 'Heavy Support',
  'dedicated transport': 'Heavy Support',
  'fortification': 'Heavy Support',
  'lord of war': 'Heavy Support',
};

// Categories that mean this is a real deployable unit (primary category check)
const UNIT_PRIMARY_CATS = new Set([
  'hq','commander','character','epic hero',
  'battleline','troops',
  'elite',
  'fast attack',
  'heavy support',
  'dedicated transport',
  'fortification',
  'lord of war',
  'vehicle','monster','beast','mounted','swarm','infantry','drone','walker',
]);

function guessRole(categories) {
  for (const cat of categories) {
    const n = (cat.name || '').toLowerCase();
    if (CATEGORY_ROLE_MAP[n]) return CATEGORY_ROLE_MAP[n];
  }
  return 'Troops';
}

function getCharVal(profile, name) {
  const c = (profile.characteristics || []).find(x => x.name === name);
  return c ? (c['$text'] || c.text || '') : '';
}

// Returns true if this selection is a real unit (not wargear/upgrade noise)
function isRealUnit(sel) {
  if (sel.type === 'model') return true;
  if (sel.type === 'unit') return true;
  // 'upgrade' or 'mount' entries at top level: only keep if they have a
  // primary category that matches a known unit category
  const primary = (sel.categories || []).find(c => c.primary);
  if (!primary) return false;
  const pn = (primary.name || '').toLowerCase();
  // Skip Configuration entries
  if (pn === 'configuration') return false;
  return UNIT_PRIMARY_CATS.has(pn);
}

function parseWeaponProfile(profile) {
  return {
    name: profile.name.replace(/^[➤►▶→•\-\s]+/, '').trim(),
    range: getCharVal(profile, 'Range') || '—',
    a:     getCharVal(profile, 'A')     || '—',
    bs:    getCharVal(profile, 'BS')    || '—',
    ws:    getCharVal(profile, 'WS')    || '',
    s:     getCharVal(profile, 'SV')     || '—',
    ap:    getCharVal(profile, 'AP')    || '—',
    d:     getCharVal(profile, 'D')     || '—',
    keywords: getCharVal(profile, 'Keywords') || '',
  };
}

function parseBattleScribe(json) {
  const roster = json.roster;
  if (!roster) throw new Error('Geen geldig roster gevonden in het JSON-bestand.');

  const imported = [];
  const forces = roster.forces || [];

  for (const force of forces) {
    for (const sel of (force.selections || [])) {
      if (!isRealUnit(sel)) continue;

      const name = sel.name;
      const pts = (sel.costs || []).find(c => c.name === 'pts')?.value || 0;
      const cats = sel.categories || [];
      const role = guessRole(cats);
      const keywords = cats.map(c => c.name).filter(n =>
        !['Configuration','Unit','Reference','Illegal Units','Uncategorized'].includes(n)
      );

      const weaponProfiles = []; // full profile objects {name, range, a, bs, s, ap, d, keywords}
      const abilities = [];

      for (const r of (sel.rules || [])) {
        if (r.name && !r.hidden) abilities.push(r.name);
      }

      const allProfiles = [];
      function collectProfiles(node) {
        for (const p of (node.profiles || [])) allProfiles.push(p);
        for (const s of (node.selections || [])) collectProfiles(s);
      }
      collectProfiles(sel);

      let move = '', t = 0, sv = '', w = 1, ld = 7, oc = 0;

      for (const p of allProfiles) {
        const tn = (p.typeName || '').toLowerCase();

        // ── Unit stat block ──────────────────────────────────────────────────
        // Match any profile that is NOT a weapon/ability profile
        if (!tn.includes('weapon') && !tn.includes('ability') &&
            !tn.includes('psychic') && !tn.includes('special')) {
          const m = getCharVal(p, 'M');
          if (m && !move) move = m;
          const tv = getCharVal(p, 'T');
          if (tv) t = parseInt(tv) || 0;

          // FIX: Sv can be labelled 'Sv' or 'Save'
          const sv = getCharVal(p, 'SV') || getCharVal(p, 'Save');
          if (sv && !sv) sv = sv;

          const wv = getCharVal(p, 'W');
          if (wv) w = parseInt(wv) || 1;
          const lv = getCharVal(p, 'Ld');
          if (lv) ld = parseInt(lv) || 7;
          const ov = getCharVal(p, 'OC');
          if (ov) oc = parseInt(ov) || 0;
        }

        // ── Weapon profiles ──────────────────────────────────────────────────
        if (tn.includes('ranged') || tn.includes('melee') || tn.includes('weapon')) {
          const wp = parseWeaponProfile(p);
          const already = weaponProfiles.find(x => x.name === wp.name);
          if (!already) weaponProfiles.push(wp);
        }

        // ── Ability profiles ─────────────────────────────────────────────────
        if (tn.includes('ability') || tn.includes('psychic') || tn.includes('special')) {
          if (p.name && !abilities.includes(p.name)) abilities.push(p.name);
        }
      }

      imported.push({
        id: nextId++,
        name, role, pts,
        move: move || '—',
        t, save: save || '—', w, ld, oc,
        weaponProfiles,
        // keep simple name list for backwards compat
        weapons: weaponProfiles.map(wp => wp.name),
        abilities, keywords, img: ''
      });
    }
  }

  return imported;
}

function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const json = JSON.parse(ev.target.result);
      const imported = parseBattleScribe(json);
      if (!imported.length) { alert('Geen units gevonden in dit bestand.'); return; }

      const mode = confirm(
        `${imported.length} unit(s) gevonden.\n\nKlik OK om SAMEN te voegen met bestaande units.\nKlik Annuleren om bestaande units te VERVANGEN.`
      );
      if (mode) {
        units = [...units, ...imported];
      } else {
        units = imported;
      }
      saveToStorage();
      render();
      alert(`✓ ${imported.length} unit(s) succesvol geïmporteerd!`);
    } catch(e) {
      alert('Fout bij het inlezen van het JSON-bestand:\n' + e.message);
      console.error(e);
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

function clearAll() {
  if (confirm('Weet je zeker dat je ALLE units wilt verwijderen?')) {
    units = [];
    saveToStorage();
    render();
  }
}

// ── Weapon detail modal ───────────────────────────────────────────────────────
function openWeaponModal(unitId) {
  const u = units.find(u => u.id === unitId);
  if (!u) return;
  const profiles = u.weaponProfiles || u.weapons.map(n => ({ name: n }));
  if (!profiles.length) return;

  const rows = profiles.map(wp => {
    const isMelee = (wp.range || '').toLowerCase() === 'melee';
    const bsLabel = isMelee ? 'WS' : 'BS';
    const bsVal   = (isMelee && wp.ws) ? wp.ws : (wp.bs || '—');
    return `
      <tr>
        <td class="wp-name">${wp.name}</td>
        <td>${wp.range || '—'}</td>
        <td>${wp.a || '—'}</td>
        <td>${bsVal}</td>
        <td>${wp.s || '—'}</td>
        <td>${wp.ap || '—'}</td>
        <td>${wp.d || '—'}</td>
        <td class="wp-kw">${wp.keywords || '—'}</td>
      </tr>`;
  }).join('');

  document.getElementById('weapon-modal-title').textContent = u.name + ' — Wapens';
  document.getElementById('weapon-table-body').innerHTML = rows;
  document.getElementById('weapon-modal-overlay').classList.add('open');
}

function closeWeaponModal() {
  document.getElementById('weapon-modal-overlay').classList.remove('open');
}

document.getElementById('weapon-modal-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeWeaponModal();
});

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  const q = document.getElementById('search').value.toLowerCase();
  const rf = document.getElementById('role-filter').value;
  const sort = document.getElementById('sort').value;

  let list = units.filter(u => {
    return (!q || u.name.toLowerCase().includes(q)) && (!rf || u.role === rf);
  });

  if (sort === 'pts') list.sort((a,b) => b.pts - a.pts);
  else if (sort === 'oc') list.sort((a,b) => b.oc - a.oc);
  else if (sort === 'role') list.sort((a,b) => a.role.localeCompare(b.role));
  else list.sort((a,b) => a.name.localeCompare(b.name));

  const grid = document.getElementById('grid');
  if (!list.length) {
    grid.innerHTML = '<div class="empty">// geen units gevonden //</div>';
    updateSummary(); return;
  }

  grid.innerHTML = list.map(u => {
    const rc = ROLE_CLASS[u.role] || 'role-troops';
    const col = ROLE_COLOR[u.role] || '#6ec6e8';
    const hasWeaponProfiles = (u.weaponProfiles && u.weaponProfiles.length) || (u.weapons && u.weapons.length);
    const weaponBtnHtml = hasWeaponProfiles
      ? `<button class="icon-btn weapon-btn" onclick="openWeaponModal(${u.id})" title="Bekijk wapenprofiel">⚙</button>`
      : '';
    return `
    <div class="card" style="--role-color:${col}">
      <div class="card-body">
        <div class="card-top">
          <div class="card-name">${u.name}</div>
          <span class="role-badge ${rc}">${u.role}</span>
        </div>

        <div class="stats-row">
          <div class="stat-box"><div class="stat-val">${u.move||'—'}</div><div class="stat-lbl">M</div></div>
          <div class="stat-box"><div class="stat-val">${u.t||'—'}</div><div class="stat-lbl">T</div></div>
          <div class="stat-box"><div class="stat-val">${u.SV||'—'}</div><div class="stat-lbl">SV</div></div>
          <div class="stat-box"><div class="stat-val">${u.w||'—'}</div><div class="stat-lbl">W</div></div>
          <div class="stat-box"><div class="stat-val">${u.ld||'—'}</div><div class="stat-lbl">LD</div></div>
          <div class="stat-box"><div class="stat-val">${u.oc||0}</div><div class="stat-lbl">OC</div></div>
        </div>

        <div class="health-row">
          <div class="health-label"><span>Health</span><span>${u.w} W</span></div>
          <div class="health-bar"><div class="health-fill" style="width:100%"></div></div>
        </div>

        ${u.weapons && u.weapons.length ? `<div class="section-label">Wapens & aanvallen</div><div class="weapons-list">${u.weapons.map(w=>`<span class="weapon-tag" onclick="openWeaponModal(${u.id})" title="Bekijk profielen" style="cursor:pointer">${w}</span>`).join('')}</div>` : ''}
        ${u.abilities && u.abilities.length ? `<div class="section-label">Abilities</div><div class="abilities-list">${u.abilities.map(a=>`<span class="ability-tag">${a}</span>`).join('')}</div>` : ''}
        ${u.keywords && u.keywords.length ? `<div class="section-label">Keywords</div><div class="keywords-list">${u.keywords.map(k=>`<span class="keyword-tag">${k}</span>`).join('')}</div>` : ''}

        <div class="card-footer">
          <div class="pts-display">${u.pts}<small>pts</small></div>
          <div class="card-actions">
            ${weaponBtnHtml}
            <button class="icon-btn del" onclick="deleteUnit(${u.id})" title="Verwijderen">✕</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  updateSummary();
}

function updateSummary() {
  const totalPts = units.reduce((s,u) => s + (Number(u.pts)||0), 0);
  const totalOC = units.reduce((s,u) => s + (Number(u.oc)||0), 0);

  document.getElementById('nav-units').textContent = units.length;
  document.getElementById('nav-pts').textContent = totalPts;
  document.getElementById('nav-oc').textContent = totalOC;

  const roleCount = {};
  units.forEach(u => roleCount[u.role] = (roleCount[u.role]||0)+1);

  document.getElementById('summary-bar').innerHTML = `
    <div class="sum-card"><div class="sum-val">${units.length}</div><div class="sum-lbl">Totaal units</div></div>
    <div class="sum-card"><div class="sum-val">${totalPts}</div><div class="sum-lbl">Totaal punten</div></div>
    <div class="sum-card"><div class="sum-val">${roleCount['HQ']||0}</div><div class="sum-lbl">HQ</div></div>
    <div class="sum-card"><div class="sum-val">${roleCount['Troops']||0}</div><div class="sum-lbl">Troops</div></div>
    <div class="sum-card"><div class="sum-val">${(roleCount['Elite']||0)+(roleCount['Fast Attack']||0)+(roleCount['Heavy Support']||0)}</div><div class="sum-lbl">Andere</div></div>
  `;
}

function openModal(u) {
  editId = u ? u.id : null;
  document.getElementById('modal-title').textContent = u ? 'Unit bewerken' : 'Nieuwe unit toevoegen';
  document.getElementById('f-name').value = u?.name || '';
  document.getElementById('f-role').value = u?.role || 'Troops';
  document.getElementById('f-move').value = u?.move || '';
  document.getElementById('f-t').value = u?.t || '';
  document.getElementById('f-save').value = u?.sv || '';
  document.getElementById('f-w').value = u?.w || '';
  document.getElementById('f-ld').value = u?.ld || '';
  document.getElementById('f-oc').value = u?.oc || '';
  document.getElementById('f-weapons').value = u?.weapons?.join(', ') || '';
  document.getElementById('f-pts').value = u?.pts || '';
  document.getElementById('f-abilities').value = u?.abilities?.join(', ') || '';
  document.getElementById('f-keywords').value = u?.keywords?.join(', ') || '';
  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

function saveUnit() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { alert('Geef de unit een naam.'); return; }
  const weaponNames = document.getElementById('f-weapons').value.split(',').map(s=>s.trim()).filter(Boolean);
  const data = {
    id: editId || nextId++,
    name,
    role: document.getElementById('f-role').value,
    pts: parseInt(document.getElementById('f-pts').value) || 0,
    move: document.getElementById('f-move').value || '—',
    t: parseInt(document.getElementById('f-t').value) || 0,
    sv: document.getElementById('f-save').value || '—',
    w: parseInt(document.getElementById('f-w').value) || 1,
    ld: parseInt(document.getElementById('f-ld').value) || 7,
    oc: parseInt(document.getElementById('f-oc').value) || 0,
    weapons: weaponNames,
    weaponProfiles: weaponNames.map(n => ({ name: n })),
    abilities: document.getElementById('f-abilities').value.split(',').map(s=>s.trim()).filter(Boolean),
    keywords: document.getElementById('f-keywords').value.split(',').map(s=>s.trim()).filter(Boolean),
  };
  if (editId) { const i = units.findIndex(u=>u.id===editId); if(i>-1) units[i]=data; }
  else units.push(data);
  saveToStorage();
  closeModal(); render();
}

function deleteUnit(id) {
  if (confirm('Unit verwijderen?')) { units = units.filter(u=>u.id!==id); saveToStorage(); render(); }
}
function editUnit(id) { const u = units.find(u=>u.id===id); if(u) openModal(u); }

document.getElementById('modal-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

render();

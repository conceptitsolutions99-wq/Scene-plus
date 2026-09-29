/* Partner & Agent Offers Portal — client app.
 * No framework/build step: plain fetch + DOM rendering so this can be
 * opened straight from `public/` with zero build tooling. */

const TOKEN = localStorage.getItem('sp_token');
const ME = JSON.parse(localStorage.getItem('sp_user') || 'null');

if (!TOKEN || !ME) {
  window.location.href = '/index.html';
}

const CATEGORY_LABELS = {
  targeted: 'Targeted Members',
  personalized: 'Personalized Offers',
  sceneplus: 'Scene+ Offers',
  partner: 'Partner Offers'
};

let STATE = {
  view: ME.role === 'partner' ? 'partnerDetail' : 'partners',   // partners | partnerDetail | points | accounts | audit
  partners: [],
  selectedPartnerId: ME.role === 'partner' ? ME.partnerId : null,
  selectedSubBrandId: null,   // null = no sub-brand chosen yet / partner has none
  selectedCategory: 'targeted',
  offersCache: {}
};

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) {
    localStorage.removeItem('sp_token');
    localStorage.removeItem('sp_user');
    window.location.href = '/index.html';
    throw new Error('Session expired');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg, type = 'success') {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initials(name) {
  const words = name.replace(/[()]/g, '').split(/\s+/).filter(w => /^[A-Za-z0-9]/.test(w));
  return words.map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

// Renders a logo image if the partner/sub-brand has a `logo` path set,
// otherwise falls back to the colour-badge initials. If the image file
// is missing (404) it gracefully falls back to initials too, instead of
// showing a broken-image icon.
function logoBadgeHtml(entity, colour) {
  if (entity.logo) {
    return `<img src="${escapeHtml(entity.logo)}" alt="${escapeHtml(entity.name)} logo"
      data-fallback-initials="${escapeHtml(initials(entity.name))}"
      data-fallback-colour="${escapeHtml(colour)}"
      style="width:100%;height:100%;object-fit:contain;border-radius:8px;"
      onerror="handleLogoError(this)" />`;
  }
  return initials(entity.name);
}
function partnerLogoStyle(entity, colour) {
  return entity.logo ? 'background:#ffffff; padding:6px;' : `background:${colour};`;
}
function handleLogoError(img) {
  const wrap = img.parentElement;
  if (!wrap) return;
  wrap.textContent = img.dataset.fallbackInitials || '';
  wrap.style.background = img.dataset.fallbackColour || '#333';
  wrap.style.padding = '0';
}

// Generic reusable filter bar. Renders a search input into `mountEl`, and
// calls `onChange(searchText)` on every keystroke (already lowercased,
// trimmed). Returns nothing — the caller owns re-rendering its own list.
function renderSearchBar(mountEl, placeholder, onChange) {
  mountEl.innerHTML = `
    <div class="field" style="max-width:340px; margin-bottom:16px;">
      <input type="text" id="__searchBarInput" placeholder="${escapeHtml(placeholder)}" autocomplete="off" />
    </div>
  `;
  const input = mountEl.querySelector('#__searchBarInput');
  input.addEventListener('input', () => onChange(input.value.trim().toLowerCase()));
}

// ---------------------------------------------------------------------------
// role permission helpers
// ---------------------------------------------------------------------------

const canManagePartner = (partnerId) => {
  if (ME.role === 'superadmin' || ME.role === 'admin') return true;
  if (ME.role === 'partner' && ME.partnerId === partnerId) return true;
  return false;
};
const isViewOnlyAgent = () => ME.role === 'agent';
const canResetPassword = (targetUser) => {
  if (ME.role === 'superadmin') return true; // including their own account
  if (ME.role === 'admin') {
    if (targetUser.id === ME.id) return true; // an admin can reset their own too
    return targetUser.role === 'agent' || targetUser.role === 'partner';
  }
  return false;
};

// ---------------------------------------------------------------------------
// nav
// ---------------------------------------------------------------------------

function renderNav() {
  const nav = document.getElementById('navMenu');
  const items = [
    { key: 'partners', label: 'Partners & Offers' }
  ];
  if (['agent', 'admin', 'superadmin'].includes(ME.role)) {
    items.push({ key: 'points', label: 'Missing Points' });
  }
  if (['admin', 'superadmin'].includes(ME.role)) {
    items.push({ key: 'accounts', label: 'Accounts' });
  }
  if (ME.role === 'superadmin' || (ME.role === 'admin' && ME.canViewFootprints)) {
    items.push({ key: 'audit', label: 'Footprints (Audit Log)' });
  }

  nav.innerHTML = `
    <div class="nav-section">
      <div class="nav-section-title">Menu</div>
      ${items.map(it => `
        <div class="nav-item ${STATE.view === it.key ? 'active' : ''}" data-nav="${it.key}">
          <span class="dot"></span>${it.label}
        </div>`).join('')}
    </div>
  `;
  nav.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => {
      if (ME.role === 'partner' && el.dataset.nav === 'partners') {
        STATE.view = 'partnerDetail';
        STATE.selectedPartnerId = ME.partnerId;
        STATE.selectedSubBrandId = null;
      } else {
        STATE.view = el.dataset.nav;
        STATE.selectedPartnerId = null;
        STATE.selectedSubBrandId = null;
      }
      render();
    });
  });

  document.getElementById('whoName').textContent = ME.name;
  document.getElementById('whoRole').textContent = ME.role.replace('sceneplus', 'Scene+');
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try { await api('/api/logout', 'POST'); } catch (e) {}
  localStorage.removeItem('sp_token');
  localStorage.removeItem('sp_user');
  window.location.href = '/index.html';
});

// ---------------------------------------------------------------------------
// PARTNERS view
// ---------------------------------------------------------------------------

async function loadPartners() {
  if (STATE.partners.length) return STATE.partners;
  const data = await api('/api/partners');
  STATE.partners = data.partners;
  return STATE.partners;
}

function partnerBadgeStyle(colour) {
  return `background:${colour};`;
}

async function renderPartnersView() {
  const main = document.getElementById('mainContent');
  main.innerHTML = `<div class="empty-state">Loading partners…</div>`;
  const partners = await loadPartners();

  main.innerHTML = `
    <div class="topbar">
      <div>
        <div class="page-title">Partners &amp; Offers</div>
        <div class="page-sub">Select a partner to see its offers, terms &amp; conditions.</div>
      </div>
    </div>
    <div id="searchMount"></div>
    <div id="partnerGridMount"></div>
  `;

  const gridMount = document.getElementById('partnerGridMount');

  function drawGrid(filterText) {
    const filtered = !filterText ? partners : partners.filter(p => p.name.toLowerCase().includes(filterText));
    if (!filtered.length) {
      gridMount.innerHTML = `<div class="empty-state">No partners match "${escapeHtml(filterText)}".</div>`;
      return;
    }
    gridMount.innerHTML = `
      <div class="partner-grid">
        ${filtered.map(p => `
          <div class="partner-card" data-partner="${p.id}">
            <div class="partner-logo" style="${partnerLogoStyle(p, p.colour)}">${logoBadgeHtml(p, p.colour)}</div>
            <div class="pname">${escapeHtml(p.name)}</div>
            <div class="psub">${p.subBrands.length ? p.subBrands.length + ' sub-brands' : 'Offers &amp; terms'}</div>
          </div>
        `).join('')}
      </div>
    `;
    gridMount.querySelectorAll('[data-partner]').forEach(el => {
      el.addEventListener('click', () => {
        STATE.view = 'partnerDetail';
        STATE.selectedPartnerId = el.dataset.partner;
        STATE.selectedSubBrandId = null;
        STATE.selectedCategory = 'targeted';
        render();
      });
    });
  }

  renderSearchBar(document.getElementById('searchMount'), 'Search partners…', drawGrid);
  drawGrid('');
}

async function renderSubBrandGridView(partner) {
  const main = document.getElementById('mainContent');
  const crumbs = ME.role === 'partner'
    ? `${escapeHtml(partner.name)}`
    : `<span class="crumb" data-back-partners>Partners</span> / ${escapeHtml(partner.name)}`;

  main.innerHTML = `
    <div class="breadcrumb">${crumbs}</div>
    <div class="topbar">
      <div>
        <div class="page-title">${escapeHtml(partner.name)}</div>
        <div class="page-sub">Select a banner to see its offers, terms &amp; conditions.</div>
      </div>
    </div>
    <div id="searchMount"></div>
    <div id="subBrandGridMount"></div>
  `;

  if (ME.role !== 'partner') {
    main.querySelector('[data-back-partners]')?.addEventListener('click', () => {
      STATE.view = 'partners'; render();
    });
  }

  const gridMount = document.getElementById('subBrandGridMount');

  function drawGrid(filterText) {
    const filtered = !filterText ? partner.subBrands : partner.subBrands.filter(sb => sb.name.toLowerCase().includes(filterText));
    if (!filtered.length) {
      gridMount.innerHTML = `<div class="empty-state">No banners match "${escapeHtml(filterText)}".</div>`;
      return;
    }
    gridMount.innerHTML = `
      <div class="partner-grid">
        ${filtered.map(sb => `
          <div class="partner-card" data-subbrand="${sb.id}">
            <div class="partner-logo" style="${partnerLogoStyle(sb, partner.colour)}">${logoBadgeHtml(sb, partner.colour)}</div>
            <div class="pname">${escapeHtml(sb.name)}</div>
            <div class="psub">Offers &amp; terms</div>
          </div>
        `).join('')}
      </div>
    `;
    gridMount.querySelectorAll('[data-subbrand]').forEach(el => {
      el.addEventListener('click', () => {
        STATE.selectedSubBrandId = el.dataset.subbrand;
        STATE.selectedCategory = 'targeted';
        render();
      });
    });
  }

  renderSearchBar(document.getElementById('searchMount'), 'Search banners…', drawGrid);
  drawGrid('');
}

async function renderPartnerDetailView() {
  const main = document.getElementById('mainContent');
  const partners = await loadPartners();
  const partner = partners.find(p => p.id === STATE.selectedPartnerId);
  if (!partner) { STATE.view = 'partners'; return render(); }

  // Partners with sub-brands show a sub-brand picker first; each sub-brand
  // has its own separate offers. Partners with no sub-brands skip straight
  // to the category tabs.
  if (partner.subBrands.length && !STATE.selectedSubBrandId) {
    return renderSubBrandGridView(partner);
  }

  const subBrand = STATE.selectedSubBrandId
    ? partner.subBrands.find(sb => sb.id === STATE.selectedSubBrandId)
    : null;

  const crumbs = ME.role === 'partner'
    ? `${escapeHtml(partner.name)}`
    : `<span class="crumb" data-back-partners>Partners</span> / ${
        subBrand ? `<span class="crumb" data-back-subbrands>${escapeHtml(partner.name)}</span> / ${escapeHtml(subBrand.name)}` : escapeHtml(partner.name)
      }`;

  main.innerHTML = `
    <div class="breadcrumb">${crumbs}</div>
    <div class="topbar">
      <div>
        <div class="page-title">${subBrand ? escapeHtml(subBrand.name) : escapeHtml(partner.name)}</div>
        <div class="page-sub">${subBrand ? 'Part of ' + escapeHtml(partner.name) : (partner.subBrands.length ? 'Choose a banner above' : 'Offer categories below')}</div>
      </div>
      ${canManagePartner(partner.id) ? `<button class="btn" id="addOfferBtn">+ Add offer</button>` : ''}
    </div>
    <div class="tabs" id="categoryTabs">
      ${Object.entries(CATEGORY_LABELS).map(([key, label]) => `
        <div class="tab ${STATE.selectedCategory === key ? 'active' : ''}" data-cat="${key}">${label}</div>
      `).join('')}
    </div>
    <div id="searchMount"></div>
    <div id="offerListWrap"><div class="empty-state">Loading offers…</div></div>
  `;

  if (ME.role !== 'partner') {
    main.querySelector('[data-back-partners]')?.addEventListener('click', () => {
      STATE.view = 'partners'; STATE.selectedSubBrandId = null; render();
    });
    main.querySelector('[data-back-subbrands]')?.addEventListener('click', () => {
      STATE.selectedSubBrandId = null; render();
    });
  }
  if (canManagePartner(partner.id)) {
    document.getElementById('addOfferBtn').addEventListener('click', () => openOfferModal(partner.id, null, STATE.selectedSubBrandId));
  }
  main.querySelectorAll('[data-cat]').forEach(el => {
    el.addEventListener('click', () => {
      STATE.selectedCategory = el.dataset.cat;
      renderPartnerDetailView();
    });
  });

  const subBrandParam = partner.subBrands.length ? `&subBrandId=${STATE.selectedSubBrandId || ''}` : '';
  const offersData = await api(`/api/offers?partnerId=${partner.id}&category=${STATE.selectedCategory}${subBrandParam}`);
  const wrap = document.getElementById('offerListWrap');

  function drawOffers(filterText) {
    const list = !filterText ? offersData.offers : offersData.offers.filter(o =>
      o.title.toLowerCase().includes(filterText) ||
      o.description.toLowerCase().includes(filterText) ||
      o.status.toLowerCase().includes(filterText)
    );
    if (!list.length) {
      wrap.innerHTML = offersData.offers.length
        ? `<div class="empty-state">No offers match "${escapeHtml(filterText)}".</div>`
        : `<div class="empty-state">No ${CATEGORY_LABELS[STATE.selectedCategory].toLowerCase()} for ${subBrand ? escapeHtml(subBrand.name) : 'this partner'} yet.</div>`;
      return;
    }
    wrap.innerHTML = `<div class="offer-list">${list.map(o => offerCardHtml(o, partner)).join('')}</div>`;

    wrap.querySelectorAll('[data-view-offer]').forEach(el => {
      el.addEventListener('click', () => openOfferDetailModal(el.dataset.viewOffer));
    });
    wrap.querySelectorAll('[data-edit-offer]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const offer = offersData.offers.find(o => o.id === el.dataset.editOffer);
        openOfferModal(partner.id, offer, offer.subBrandId);
      });
    });
    wrap.querySelectorAll('[data-delete-offer]').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this offer? This cannot be undone.')) return;
        try {
          await api(`/api/offers/${el.dataset.deleteOffer}`, 'DELETE');
          toast('Offer deleted');
          renderPartnerDetailView();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  if (offersData.offers.length) {
    renderSearchBar(document.getElementById('searchMount'), 'Search offers…', drawOffers);
  }
  drawOffers('');
}

function offerCardHtml(o, partner) {
  const editable = canManagePartner(partner.id);
  const statusClass = o.status === 'active' ? 'status-active' : 'status-expired';
  return `
    <div class="offer-card" data-view-offer="${o.id}" style="cursor:pointer;">
      <div>
        <div class="otitle">${escapeHtml(o.title)}</div>
        <div class="odesc">${escapeHtml(o.description)}</div>
        <div class="offer-meta">
          <span class="badge points">${o.pointsValue} pts</span>
          <span class="badge ${statusClass}">${o.status}</span>
          ${o.endDate ? `<span class="badge">Ends ${o.endDate}</span>` : ''}
        </div>
      </div>
      <div class="offer-actions">
        ${editable ? `
          <button class="icon-btn" data-edit-offer="${o.id}">Edit</button>
          <button class="icon-btn" data-delete-offer="${o.id}">Delete</button>
        ` : `<button class="icon-btn" data-view-offer="${o.id}">View T&amp;Cs</button>`}
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Offer detail modal (view-only, shows full terms & conditions)
// ---------------------------------------------------------------------------

async function openOfferDetailModal(offerId) {
  const data = await api(`/api/offers/${offerId}`);
  const o = data.offer;
  showModal(`
    <h3>${escapeHtml(o.title)}</h3>
    <p style="color:var(--text-dim);">${escapeHtml(o.description)}</p>
    <div class="offer-meta" style="margin-bottom:14px;">
      <span class="badge points">${o.pointsValue} pts</span>
      <span class="badge">${o.startDate || '—'} → ${o.endDate || '—'}</span>
      <span class="badge">${CATEGORY_LABELS[o.category] || o.category}</span>
    </div>
    <div class="field">
      <label>Terms &amp; Conditions</label>
      <div style="background:var(--panel-2); border:1px solid var(--border); border-radius:8px; padding:12px; font-size:13px; color:var(--text-dim); white-space:pre-wrap;">${escapeHtml(o.termsAndConditions || 'No terms and conditions on file for this offer yet.')}</div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" data-close>Close</button>
    </div>
  `);
}

// ---------------------------------------------------------------------------
// Add / edit offer modal
// ---------------------------------------------------------------------------

function openOfferModal(partnerId, offer, subBrandId) {
  const isEdit = !!offer;
  showModal(`
    <h3>${isEdit ? 'Edit offer' : 'Add offer'}</h3>
    <div class="field">
      <label>Category</label>
      <select id="f_category">
        ${Object.entries(CATEGORY_LABELS).map(([k, l]) => `<option value="${k}" ${offer?.category === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>Title</label><input id="f_title" value="${escapeHtml(offer?.title || '')}" /></div>
    <div class="field"><label>Description</label><textarea id="f_description" rows="2">${escapeHtml(offer?.description || '')}</textarea></div>
    <div class="field"><label>Terms &amp; Conditions</label><textarea id="f_tc" rows="4">${escapeHtml(offer?.termsAndConditions || '')}</textarea></div>
    <div class="grid-2">
      <div class="field"><label>Points value</label><input id="f_points" type="number" value="${offer?.pointsValue ?? 0}" /></div>
      <div class="field"><label>Status</label>
        <select id="f_status">
          <option value="active" ${offer?.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="expired" ${offer?.status === 'expired' ? 'selected' : ''}>Expired</option>
          <option value="draft" ${offer?.status === 'draft' ? 'selected' : ''}>Draft</option>
        </select>
      </div>
    </div>
    <div class="grid-2">
      <div class="field"><label>Start date</label><input id="f_start" type="date" value="${offer?.startDate || ''}" /></div>
      <div class="field"><label>End date</label><input id="f_end" type="date" value="${offer?.endDate || ''}" /></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" data-close>Cancel</button>
      <button class="btn" id="saveOfferBtn">${isEdit ? 'Save changes' : 'Add offer'}</button>
    </div>
  `);

  document.getElementById('saveOfferBtn').addEventListener('click', async () => {
    const payload = {
      partnerId,
      subBrandId: subBrandId || null,
      category: document.getElementById('f_category').value,
      title: document.getElementById('f_title').value.trim(),
      description: document.getElementById('f_description').value.trim(),
      termsAndConditions: document.getElementById('f_tc').value.trim(),
      pointsValue: Number(document.getElementById('f_points').value) || 0,
      status: document.getElementById('f_status').value,
      startDate: document.getElementById('f_start').value || null,
      endDate: document.getElementById('f_end').value || null
    };
    if (!payload.title || !payload.description) { toast('Title and description are required', 'error'); return; }
    try {
      if (isEdit) {
        await api(`/api/offers/${offer.id}`, 'PUT', payload);
        toast('Offer updated');
      } else {
        await api('/api/offers', 'POST', payload);
        toast('Offer added');
      }
      closeModal();
      renderPartnerDetailView();
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ---------------------------------------------------------------------------
// POINTS REQUESTS view  ("add missing points for a member")
// ---------------------------------------------------------------------------

async function renderPointsView() {
  const main = document.getElementById('mainContent');
  main.innerHTML = `<div class="empty-state">Loading…</div>`;
  const partners = await loadPartners();
  const data = await api('/api/points-requests');
  const list = data.pointsRequests;

  const canResolve = ['admin', 'superadmin'].includes(ME.role);
  const canSubmit = ['agent', 'admin', 'superadmin'].includes(ME.role);

  const counts = {
    pending: list.filter(r => r.status === 'pending').length,
    approved: list.filter(r => r.status === 'approved').length,
    rejected: list.filter(r => r.status === 'rejected').length
  };

  main.innerHTML = `
    <div class="topbar">
      <div>
        <div class="page-title">Missing Points Requests</div>
        <div class="page-sub">${ME.role === 'agent' ? 'Log a missing-points correction for a member and track its status.' : 'Review and resolve missing-points requests submitted by agents.'}</div>
      </div>
      ${canSubmit ? `<button class="btn" id="newPointsReqBtn">+ New request</button>` : ''}
    </div>
    <div class="stat-row">
      <div class="stat"><div class="num">${counts.pending}</div><div class="label">Pending</div></div>
      <div class="stat"><div class="num">${counts.approved}</div><div class="label">Approved</div></div>
      <div class="stat"><div class="num">${counts.rejected}</div><div class="label">Rejected</div></div>
    </div>
    <div id="searchMount"></div>
    <div id="pointsTableWrap"></div>
  `;

  const wrap = document.getElementById('pointsTableWrap');

  function drawTable(filterText) {
    const filtered = !filterText ? list : list.filter(r => {
      const partner = partners.find(p => p.id === r.partnerId);
      return r.memberId.toLowerCase().includes(filterText) ||
        (partner?.name || r.partnerId).toLowerCase().includes(filterText) ||
        r.reason.toLowerCase().includes(filterText) ||
        r.submittedBy.toLowerCase().includes(filterText) ||
        r.status.toLowerCase().includes(filterText);
    });

    if (!filtered.length) {
      wrap.innerHTML = list.length
        ? `<div class="empty-state">No requests match "${escapeHtml(filterText)}".</div>`
        : `<div class="empty-state">No requests yet.</div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>Member</th><th>Partner</th><th>Purchase date</th><th>Points</th><th>Reason</th><th>Submitted by</th><th>Status</th>${canResolve ? '<th></th>' : ''}
        </tr></thead>
        <tbody>
          ${filtered.map(r => {
            const partner = partners.find(p => p.id === r.partnerId);
            return `
              <tr>
                <td>${escapeHtml(r.memberId)}</td>
                <td>${escapeHtml(partner?.name || r.partnerId)}</td>
                <td>${r.purchaseDate}</td>
                <td>${r.pointsRequested}</td>
                <td>${escapeHtml(r.reason)}</td>
                <td>${escapeHtml(r.submittedBy)}</td>
                <td>
                  ${canResolve
                    ? `<select class="status-select" data-resolve="${r.id}">
                        <option value="pending" ${r.status === 'pending' ? 'selected' : ''}>Pending</option>
                        <option value="approved" ${r.status === 'approved' ? 'selected' : ''}>Approved</option>
                        <option value="rejected" ${r.status === 'rejected' ? 'selected' : ''}>Rejected</option>
                      </select>`
                    : `<span class="badge ${r.status === 'approved' ? 'status-active' : r.status === 'rejected' ? 'status-expired' : ''}">${r.status}</span>`}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
    wrap.querySelectorAll('[data-resolve]').forEach(el => {
      el.addEventListener('change', async () => {
        try {
          await api(`/api/points-requests/${el.dataset.resolve}`, 'PUT', { status: el.value });
          toast('Request updated');
          renderPointsView();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  if (list.length) {
    renderSearchBar(document.getElementById('searchMount'), 'Search by member, partner, reason, submitter, status…', drawTable);
  }
  drawTable('');

  if (canSubmit) {
    document.getElementById('newPointsReqBtn').addEventListener('click', () => openPointsRequestModal(partners));
  }
}

function openPointsRequestModal(partners) {
  showModal(`
    <h3>New missing-points request</h3>
    <div class="field"><label>Member ID / card number</label><input id="pr_member" placeholder="e.g. SP-88213456" /></div>
    <div class="field"><label>Partner</label>
      <select id="pr_partner">${partners.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select>
    </div>
    <div class="grid-2">
      <div class="field"><label>Purchase date</label><input id="pr_date" type="date" /></div>
      <div class="field"><label>Points to add</label><input id="pr_points" type="number" value="0" /></div>
    </div>
    <div class="field"><label>Reason / notes</label><textarea id="pr_reason" rows="3" placeholder="What happened — e.g. receipt shows purchase but points never posted"></textarea></div>
    <div class="modal-actions">
      <button class="btn btn-secondary" data-close>Cancel</button>
      <button class="btn" id="submitPointsReqBtn">Submit request</button>
    </div>
  `);
  document.getElementById('submitPointsReqBtn').addEventListener('click', async () => {
    const payload = {
      memberId: document.getElementById('pr_member').value.trim(),
      partnerId: document.getElementById('pr_partner').value,
      purchaseDate: document.getElementById('pr_date').value,
      pointsRequested: Number(document.getElementById('pr_points').value) || 0,
      reason: document.getElementById('pr_reason').value.trim()
    };
    if (!payload.memberId || !payload.purchaseDate || !payload.reason) {
      toast('Member ID, purchase date and reason are required', 'error'); return;
    }
    try {
      await api('/api/points-requests', 'POST', payload);
      toast('Request submitted');
      closeModal();
      renderPointsView();
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ---------------------------------------------------------------------------
// ACCOUNTS view (admin / superadmin)
// ---------------------------------------------------------------------------

async function renderAccountsView() {
  const main = document.getElementById('mainContent');
  main.innerHTML = `<div class="empty-state">Loading…</div>`;
  const partners = await loadPartners();
  const data = await api('/api/users');
  const users = data.users;

  main.innerHTML = `
    <div class="topbar">
      <div>
        <div class="page-title">Accounts</div>
        <div class="page-sub">No self sign-up — create and manage partner &amp; agent accounts here.</div>
      </div>
      <button class="btn" id="newUserBtn">+ New account</button>
    </div>
    <div id="searchMount"></div>
    <div id="accountsTableWrap"></div>
  `;

  document.getElementById('newUserBtn').addEventListener('click', () => openUserModal(partners));
  const wrap = document.getElementById('accountsTableWrap');

  function drawTable(filterText) {
    const filtered = !filterText ? users : users.filter(u => {
      const partnerName = u.partnerId ? (partners.find(p => p.id === u.partnerId)?.name || u.partnerId) : '';
      return u.name.toLowerCase().includes(filterText) ||
        u.username.toLowerCase().includes(filterText) ||
        u.role.toLowerCase().includes(filterText) ||
        partnerName.toLowerCase().includes(filterText) ||
        (u.active ? 'active' : 'disabled').includes(filterText);
    });

    if (!filtered.length) {
      wrap.innerHTML = `<div class="empty-state">No accounts match "${escapeHtml(filterText)}".</div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Partner</th><th>Status</th><th>Footprints access</th><th></th></tr></thead>
        <tbody>
          ${filtered.map(u => `
            <tr>
              <td>${escapeHtml(u.name)}</td>
              <td>${escapeHtml(u.username)}</td>
              <td>${u.role}</td>
              <td>${u.partnerId ? escapeHtml(partners.find(p => p.id === u.partnerId)?.name || u.partnerId) : '—'}</td>
              <td><span class="badge ${u.active ? 'status-active' : 'status-expired'}">${u.active ? 'active' : 'disabled'}</span></td>
              <td>
                ${u.role === 'superadmin' ? '<span class="badge status-active">always</span>' : ''}
                ${u.role === 'admin' && ME.role === 'superadmin' ? `<button class="icon-btn" data-toggle-footprints="${u.id}" data-value="${u.canViewFootprints}">${u.canViewFootprints ? 'Revoke' : 'Grant'}</button>` : ''}
                ${u.role === 'admin' && ME.role !== 'superadmin' ? `<span class="badge ${u.canViewFootprints ? 'status-active' : 'status-expired'}">${u.canViewFootprints ? 'granted' : 'not granted'}</span>` : ''}
                ${(u.role !== 'superadmin' && u.role !== 'admin') ? '—' : ''}
              </td>
              <td>
                ${u.id !== ME.id ? `<button class="icon-btn" data-toggle-user="${u.id}" data-active="${u.active}">${u.active ? 'Disable' : 'Enable'}</button>` : ''}
                ${canResetPassword(u) ? `<button class="icon-btn" data-reset-password="${u.id}" data-username="${escapeHtml(u.username)}">Reset password</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    wrap.querySelectorAll('[data-toggle-user]').forEach(el => {
      el.addEventListener('click', async () => {
        try {
          await api(`/api/users/${el.dataset.toggleUser}`, 'PUT', { active: el.dataset.active !== 'true' });
          toast('Account updated');
          renderAccountsView();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
    wrap.querySelectorAll('[data-toggle-footprints]').forEach(el => {
      el.addEventListener('click', async () => {
        try {
          await api(`/api/users/${el.dataset.toggleFootprints}`, 'PUT', { canViewFootprints: el.dataset.value !== 'true' });
          toast('Footprints access updated');
          renderAccountsView();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
    wrap.querySelectorAll('[data-reset-password]').forEach(el => {
      el.addEventListener('click', () => openResetPasswordModal(el.dataset.resetPassword, el.dataset.username));
    });
  }

  renderSearchBar(document.getElementById('searchMount'), 'Search by name, username, role, partner, status…', drawTable);
  drawTable('');
}

function openUserModal(partners) {
  const roleOptions = ME.role === 'superadmin'
    ? ['agent', 'partner', 'admin', 'superadmin']
    : ['agent', 'partner']; // admin can only create agent/partner accounts

  showModal(`
    <h3>New account</h3>
    <div class="field"><label>Full name</label><input id="u_name" /></div>
    <div class="field"><label>Username</label><input id="u_username" placeholder="e.g. agent2" /></div>
    <div class="field"><label>Temporary password</label><input id="u_password" type="text" placeholder="Give this to the person, then have them change it" /></div>
    <div class="field"><label>Role</label>
      <select id="u_role">${roleOptions.map(r => `<option value="${r}">${r}</option>`).join('')}</select>
    </div>
    <div class="field" id="u_partnerWrap" style="display:none;">
      <label>Partner (for partner-role accounts)</label>
      <select id="u_partner">${partners.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select>
    </div>
    <div class="field" id="u_footprintsWrap" style="display:none;">
      <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
        <input type="checkbox" id="u_canViewFootprints" checked style="width:auto;" />
        Can view Footprints (audit log)
      </label>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" data-close>Cancel</button>
      <button class="btn" id="saveUserBtn">Create account</button>
    </div>
  `);
  const roleSelect = document.getElementById('u_role');
  const partnerWrap = document.getElementById('u_partnerWrap');
  const footprintsWrap = document.getElementById('u_footprintsWrap');
  const syncPartnerWrap = () => {
    partnerWrap.style.display = roleSelect.value === 'partner' ? 'block' : 'none';
    footprintsWrap.style.display = roleSelect.value === 'admin' ? 'block' : 'none';
  };
  roleSelect.addEventListener('change', syncPartnerWrap);
  syncPartnerWrap();

  document.getElementById('saveUserBtn').addEventListener('click', async () => {
    const payload = {
      name: document.getElementById('u_name').value.trim(),
      username: document.getElementById('u_username').value.trim(),
      password: document.getElementById('u_password').value,
      role: roleSelect.value,
      partnerId: roleSelect.value === 'partner' ? document.getElementById('u_partner').value : undefined,
      canViewFootprints: roleSelect.value === 'admin' ? document.getElementById('u_canViewFootprints').checked : undefined
    };
    if (!payload.name || !payload.username || !payload.password) { toast('Name, username and password are required', 'error'); return; }
    try {
      await api('/api/users', 'POST', payload);
      toast('Account created');
      closeModal();
      renderAccountsView();
    } catch (err) { toast(err.message, 'error'); }
  });
}

function openResetPasswordModal(userId, username) {
  showModal(`
    <h3>Reset password</h3>
    <p style="color:var(--text-dim); font-size:13px;">Set a new temporary password for <b>${escapeHtml(username)}</b>. Share it with them directly — they can change it themselves afterward from their own "Change password" option.</p>
    <div class="field"><label>New temporary password</label><input id="rp_password" type="text" autocomplete="off" /></div>
    <div class="modal-actions">
      <button class="btn btn-secondary" data-close>Cancel</button>
      <button class="btn" id="rp_save">Set password</button>
    </div>
  `);
  document.getElementById('rp_save').addEventListener('click', async () => {
    const password = document.getElementById('rp_password').value;
    if (!password || password.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
    try {
      await api(`/api/users/${userId}`, 'PUT', { password });
      toast('Password reset');
      closeModal();
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ---------------------------------------------------------------------------
// AUDIT LOG view
// ---------------------------------------------------------------------------

async function renderAuditView() {
  const main = document.getElementById('mainContent');
  main.innerHTML = `<div class="empty-state">Loading…</div>`;
  const data = await api('/api/audit');
  const log = data.auditLog;
  const actionTypes = [...new Set(log.map(a => a.action))].sort();

  main.innerHTML = `
    <div class="topbar">
      <div>
        <div class="page-title">Footprints (Audit Log)</div>
        <div class="page-sub">Every account action, most recent first.</div>
      </div>
    </div>
    <div style="display:flex; gap:10px; align-items:flex-end; margin-bottom:16px; flex-wrap:wrap;">
      <div class="field" style="max-width:340px; margin-bottom:0;">
        <label>Search</label>
        <input type="text" id="auditSearchInput" placeholder="Search by user, role, action, target…" autocomplete="off" />
      </div>
      <div class="field" style="max-width:220px; margin-bottom:0;">
        <label>Action type</label>
        <select id="auditActionFilter">
          <option value="">All actions</option>
          ${actionTypes.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a.replace(/_/g, ' '))}</option>`).join('')}
        </select>
      </div>
      <div id="auditResultCount" style="color:var(--text-dim); font-size:12.5px; padding-bottom:10px;"></div>
    </div>
    <div id="auditTableWrap"></div>
  `;

  const wrap = document.getElementById('auditTableWrap');
  const countEl = document.getElementById('auditResultCount');
  const searchInput = document.getElementById('auditSearchInput');
  const actionSelect = document.getElementById('auditActionFilter');

  function drawTable() {
    const filterText = searchInput.value.trim().toLowerCase();
    const actionFilter = actionSelect.value;
    const filtered = log.filter(a => {
      if (actionFilter && a.action !== actionFilter) return false;
      if (!filterText) return true;
      const when = new Date(a.at).toLocaleString().toLowerCase();
      return a.username.toLowerCase().includes(filterText) ||
        a.role.toLowerCase().includes(filterText) ||
        a.action.replace(/_/g, ' ').toLowerCase().includes(filterText) ||
        a.target.toLowerCase().includes(filterText) ||
        when.includes(filterText);
    });

    countEl.textContent = `${filtered.length} of ${log.length} entries`;

    if (!filtered.length) {
      wrap.innerHTML = `<div class="empty-state">No footprints match your filters.</div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>When</th><th>User</th><th>Role</th><th>Action</th><th>Target</th></tr></thead>
        <tbody>
          ${filtered.map(a => `
            <tr>
              <td>${new Date(a.at).toLocaleString()}</td>
              <td>${escapeHtml(a.username)}</td>
              <td>${a.role}</td>
              <td>${a.action.replace(/_/g, ' ')}</td>
              <td>${escapeHtml(a.target)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  searchInput.addEventListener('input', drawTable);
  actionSelect.addEventListener('change', drawTable);
  drawTable();
}

// ---------------------------------------------------------------------------
// modal helpers
// ---------------------------------------------------------------------------

function showModal(html) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
  root.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeModal));
  root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) closeModal();
  });
}
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------

async function render() {
  renderNav();
  try {
    if (STATE.view === 'partners') await renderPartnersView();
    else if (STATE.view === 'partnerDetail') await renderPartnerDetailView();
    else if (STATE.view === 'points') await renderPointsView();
    else if (STATE.view === 'accounts') await renderAccountsView();
    else if (STATE.view === 'audit') await renderAuditView();
  } catch (err) {
    document.getElementById('mainContent').innerHTML = `<div class="error-msg">${escapeHtml(err.message)}</div>`;
  }
}

render();

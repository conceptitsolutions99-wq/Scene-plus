// server.js
// Scene+ Partner & Agent Offers Portal — prototype backend.
// Deliberately zero external dependencies (only Node's built-in modules)
// so it runs anywhere Node runs with no `npm install` step: `node server.js`.

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const db = require('./lib/db');
const sessions = require('./lib/sessions');
const otp = require('./lib/otp');
const mailer = require('./lib/mailer');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 2 * 1024 * 1024) { // 2MB guard
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function getToken(req) {
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

function currentUser(req) {
  const token = getToken(req);
  if (!token) return null;
  const userId = sessions.getUserId(token);
  if (!userId) return null;
  const data = db.load();
  const user = data.users.find(u => u.id === userId && u.active);
  return user || null;
}

function publicUser(u) {
  return {
    id: u.id, username: u.username, name: u.name, role: u.role, partnerId: u.partnerId,
    active: u.active, createdAt: u.createdAt,
    canViewFootprints: u.role === 'superadmin' ? true : !!u.canViewFootprints
  };
}

// role helpers -----------------------------------------------------------
const canManageOffersFor = (user, partnerId) => {
  if (user.role === 'superadmin' || user.role === 'admin') return true;
  if (user.role === 'partner' && user.partnerId === partnerId) return true;
  return false;
};

// ---------------------------------------------------------------------------
// route table: [method, regex, handler]
// handler(req, res, params, user)
// ---------------------------------------------------------------------------

const routes = [];
function route(method, pattern, handler, opts = {}) {
  // convert "/api/offers/:id" -> regex with named group
  const keys = [];
  const regexStr = '^' + pattern.replace(/:[a-zA-Z]+/g, (m) => {
    keys.push(m.slice(1));
    return '([^/]+)';
  }) + '$';
  routes.push({ method, regex: new RegExp(regexStr), keys, handler, opts });
}

function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.regex.exec(pathname);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, params, opts: r.opts };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------

route('POST', '/api/login', async (req, res) => {
  const body = await readBody(req);
  const { username, password } = body;
  const data = db.load();
  const user = data.users.find(u => u.username === (username || '').trim().toLowerCase() && u.active);
  if (!user || !password || !db.verifyPassword(password, user.salt, user.hash)) {
    return sendJson(res, 401, { error: 'Invalid username or password' });
  }
  const token = sessions.createSession(user.id);
  db.addAudit(data, { userId: user.id, username: user.username, role: user.role, action: 'login', target: '-' });
  db.save(data);
  sendJson(res, 200, { token, user: publicUser(user) });
});

route('POST', '/api/logout', (req, res) => {
  const token = getToken(req);
  if (token) sessions.destroySession(token);
  sendJson(res, 200, { ok: true });
});

// ---------------------------------------------------------------------------
// FORGOT PASSWORD — email OTP flow (no auth required, since the person
// isn't signed in yet). Usernames are expected to be email addresses so the
// OTP has somewhere to go; see mailer.js for how the email actually sends.
// ---------------------------------------------------------------------------

async function sendOtpFor(username) {
  const data = db.load();
  const user = data.users.find(u => u.username === username && u.active);
  if (!user) return { userExists: false, devMode: false };
  const { code } = otp.createOtp(username);
  const result = await mailer.sendMail({
    to: user.username,
    subject: 'Your Partner & Agent Offers Portal verification code',
    text: `Your one-time password is: ${code}\n\nThis code expires in 15 minutes. If you didn't request this, you can safely ignore this email.`
  });
  return { userExists: true, devMode: result.devMode };
}

route('POST', '/api/password-reset/request', async (req, res) => {
  const body = await readBody(req);
  const username = (body.username || '').trim().toLowerCase();
  if (!username) return sendJson(res, 400, { error: 'Username is required' });
  const wait = otp.msUntilResendAllowed(username);
  if (wait > 0) return sendJson(res, 429, { error: `Please wait ${Math.ceil(wait / 1000)}s before requesting another code` });
  const result = await sendOtpFor(username);
  // Always respond success-shaped, regardless of whether the account exists,
  // so this can't be used to discover which usernames are registered.
  sendJson(res, 200, { ok: true, devMode: result.devMode });
});

route('POST', '/api/password-reset/resend', async (req, res) => {
  const body = await readBody(req);
  const username = (body.username || '').trim().toLowerCase();
  if (!username) return sendJson(res, 400, { error: 'Username is required' });
  const wait = otp.msUntilResendAllowed(username);
  if (wait > 0) return sendJson(res, 429, { error: `Please wait ${Math.ceil(wait / 1000)}s before requesting another code` });
  const result = await sendOtpFor(username);
  sendJson(res, 200, { ok: true, devMode: result.devMode });
});

route('POST', '/api/password-reset/verify', async (req, res) => {
  const body = await readBody(req);
  const username = (body.username || '').trim().toLowerCase();
  const code = (body.otp || '').trim();
  if (!username || !code) return sendJson(res, 400, { error: 'Username and code are required' });
  const result = otp.verifyOtp(username, code);
  if (!result.ok) return sendJson(res, 400, { error: result.error });
  sendJson(res, 200, { ok: true, resetToken: result.resetToken });
});

route('POST', '/api/password-reset/complete', async (req, res) => {
  const body = await readBody(req);
  const username = (body.username || '').trim().toLowerCase();
  const { resetToken, newPassword } = body;
  if (!username || !resetToken || !newPassword) return sendJson(res, 400, { error: 'Missing required fields' });
  if (newPassword.length < 8) return sendJson(res, 400, { error: 'New password must be at least 8 characters' });
  const consumed = otp.consumeResetToken(username, resetToken);
  if (!consumed.ok) return sendJson(res, 400, { error: consumed.error });
  const data = db.load();
  const user = data.users.find(u => u.username === username && u.active);
  if (!user) return sendJson(res, 400, { error: 'Account not found' });
  const { salt, hash } = db.hashPassword(newPassword);
  user.salt = salt; user.hash = hash;
  db.addAudit(data, { userId: user.id, username: user.username, role: user.role, action: 'reset_password_via_otp', target: user.username });
  db.save(data);
  sendJson(res, 200, { ok: true });
});

route('GET', '/api/me', (req, res, params, user) => {
  sendJson(res, 200, { user: publicUser(user) });
}, { auth: true });

// ---------------------------------------------------------------------------
// PARTNERS
// ---------------------------------------------------------------------------

route('GET', '/api/partners', (req, res, params, user) => {
  const data = db.load();
  let partners = data.partners;
  if (user.role === 'partner') {
    partners = partners.filter(p => p.id === user.partnerId);
  }
  sendJson(res, 200, { partners });
}, { auth: true });

route('POST', '/api/partners', async (req, res, params, user) => {
  const body = await readBody(req);
  if (!body.name) return sendJson(res, 400, { error: 'name is required' });
  const data = db.load();
  const partner = {
    id: (body.id || body.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    name: body.name,
    colour: body.colour || '#111111',
    subBrands: Array.isArray(body.subBrands) ? body.subBrands : []
  };
  if (data.partners.some(p => p.id === partner.id)) {
    return sendJson(res, 409, { error: 'A partner with that id already exists' });
  }
  data.partners.push(partner);
  db.addAudit(data, { userId: user.id, username: user.username, role: user.role, action: 'create_partner', target: partner.id });
  db.save(data);
  sendJson(res, 201, { partner });
}, { auth: true, roles: ['superadmin'] });

route('PUT', '/api/partners/:id', async (req, res, params, user) => {
  const body = await readBody(req);
  const data = db.load();
  const partner = data.partners.find(p => p.id === params.id);
  if (!partner) return sendJson(res, 404, { error: 'Partner not found' });
  if (body.name !== undefined) partner.name = body.name;
  if (body.colour !== undefined) partner.colour = body.colour;
  if (body.subBrands !== undefined && Array.isArray(body.subBrands)) partner.subBrands = body.subBrands;
  db.addAudit(data, { userId: user.id, username: user.username, role: user.role, action: 'edit_partner', target: partner.id });
  db.save(data);
  sendJson(res, 200, { partner });
}, { auth: true, roles: ['superadmin'] });

route('DELETE', '/api/partners/:id', (req, res, params, user) => {
  const data = db.load();
  const idx = data.partners.findIndex(p => p.id === params.id);
  if (idx === -1) return sendJson(res, 404, { error: 'Partner not found' });
  const [removed] = data.partners.splice(idx, 1);
  data.offers = data.offers.filter(o => o.partnerId !== params.id);
  db.addAudit(data, { userId: user.id, username: user.username, role: user.role, action: 'delete_partner', target: removed.id });
  db.save(data);
  sendJson(res, 200, { ok: true });
}, { auth: true, roles: ['superadmin'] });

// ---------------------------------------------------------------------------
// OFFERS
// ---------------------------------------------------------------------------

route('GET', '/api/offers', (req, res, params, user, query) => {
  const data = db.load();
  let offers = data.offers;
  if (user.role === 'partner') {
    offers = offers.filter(o => o.partnerId === user.partnerId);
  } else if (query.partnerId) {
    offers = offers.filter(o => o.partnerId === query.partnerId);
  }
  if (query.category) offers = offers.filter(o => o.category === query.category);
  if (query.subBrandId !== undefined) {
    offers = offers.filter(o => (o.subBrandId || null) === (query.subBrandId || null));
  }
  sendJson(res, 200, { offers });
}, { auth: true });

route('GET', '/api/offers/:id', (req, res, params, user) => {
  const data = db.load();
  const offer = data.offers.find(o => o.id === params.id);
  if (!offer) return sendJson(res, 404, { error: 'Offer not found' });
  if (user.role === 'partner' && offer.partnerId !== user.partnerId) {
    return sendJson(res, 403, { error: 'You cannot view offers for another partner' });
  }
  sendJson(res, 200, { offer });
}, { auth: true });

route('POST', '/api/offers', async (req, res, params, user) => {
  const body = await readBody(req);
  const required = ['partnerId', 'category', 'title', 'description'];
  for (const f of required) {
    if (!body[f]) return sendJson(res, 400, { error: `${f} is required` });
  }
  if (!canManageOffersFor(user, body.partnerId)) {
    return sendJson(res, 403, { error: 'You cannot add offers for this partner' });
  }
  const data = db.load();
  if (!data.partners.some(p => p.id === body.partnerId)) {
    return sendJson(res, 400, { error: 'Unknown partnerId' });
  }
  const offer = {
    id: db.uid('offer'),
    partnerId: body.partnerId,
    subBrandId: body.subBrandId || null,
    category: body.category, // targeted | personalized | sceneplus | partner
    title: body.title,
    description: body.description,
    termsAndConditions: body.termsAndConditions || '',
    pointsValue: Number(body.pointsValue) || 0,
    startDate: body.startDate || null,
    endDate: body.endDate || null,
    status: body.status || 'active',
    createdBy: user.username,
    updatedAt: new Date().toISOString()
  };
  data.offers.push(offer);
  db.addAudit(data, { userId: user.id, username: user.username, role: user.role, action: 'create_offer', target: `${offer.partnerId}/${offer.title}` });
  db.save(data);
  sendJson(res, 201, { offer });
}, { auth: true, roles: ['partner', 'admin', 'superadmin'] });

route('PUT', '/api/offers/:id', async (req, res, params, user) => {
  const data = db.load();
  const offer = data.offers.find(o => o.id === params.id);
  if (!offer) return sendJson(res, 404, { error: 'Offer not found' });
  if (!canManageOffersFor(user, offer.partnerId)) {
    return sendJson(res, 403, { error: 'You cannot edit offers for this partner' });
  }
  const body = await readBody(req);
  const editable = ['category', 'title', 'description', 'termsAndConditions', 'pointsValue', 'startDate', 'endDate', 'status', 'subBrandId'];
  for (const f of editable) {
    if (body[f] !== undefined) offer[f] = f === 'pointsValue' ? Number(body[f]) : body[f];
  }
  offer.updatedAt = new Date().toISOString();
  db.addAudit(data, { userId: user.id, username: user.username, role: user.role, action: 'edit_offer', target: `${offer.partnerId}/${offer.title}` });
  db.save(data);
  sendJson(res, 200, { offer });
}, { auth: true, roles: ['partner', 'admin', 'superadmin'] });

route('DELETE', '/api/offers/:id', (req, res, params, user) => {
  const data = db.load();
  const idx = data.offers.findIndex(o => o.id === params.id);
  if (idx === -1) return sendJson(res, 404, { error: 'Offer not found' });
  const offer = data.offers[idx];
  if (!canManageOffersFor(user, offer.partnerId)) {
    return sendJson(res, 403, { error: 'You cannot delete offers for this partner' });
  }
  data.offers.splice(idx, 1);
  db.addAudit(data, { userId: user.id, username: user.username, role: user.role, action: 'delete_offer', target: `${offer.partnerId}/${offer.title}` });
  db.save(data);
  sendJson(res, 200, { ok: true });
}, { auth: true, roles: ['partner', 'admin', 'superadmin'] });

// ---------------------------------------------------------------------------
// POINTS ADJUSTMENT REQUESTS  ("add missing points for a member")
// ---------------------------------------------------------------------------

route('GET', '/api/points-requests', (req, res, params, user) => {
  const data = db.load();
  let list = data.pointsRequests;
  if (user.role === 'agent') list = list.filter(r => r.submittedBy === user.username);
  sendJson(res, 200, { pointsRequests: list });
}, { auth: true });

route('POST', '/api/points-requests', async (req, res, params, user) => {
  const body = await readBody(req);
  const required = ['memberId', 'partnerId', 'purchaseDate', 'pointsRequested', 'reason'];
  for (const f of required) {
    if (body[f] === undefined || body[f] === '') return sendJson(res, 400, { error: `${f} is required` });
  }
  const data = db.load();
  if (!data.partners.some(p => p.id === body.partnerId)) {
    return sendJson(res, 400, { error: 'Unknown partnerId' });
  }
  const reqObj = {
    id: db.uid('preq'),
    memberId: body.memberId,
    partnerId: body.partnerId,
    offerId: body.offerId || null,
    purchaseDate: body.purchaseDate,
    pointsRequested: Number(body.pointsRequested) || 0,
    reason: body.reason,
    status: 'pending', // pending | approved | rejected
    submittedBy: user.username,
    submittedAt: new Date().toISOString(),
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null
  };
  data.pointsRequests.unshift(reqObj);
  db.addAudit(data, { userId: user.id, username: user.username, role: user.role, action: 'submit_points_request', target: `${reqObj.partnerId}/member:${reqObj.memberId}` });
  db.save(data);
  sendJson(res, 201, { pointsRequest: reqObj });
}, { auth: true, roles: ['agent', 'admin', 'superadmin'] });

route('PUT', '/api/points-requests/:id', async (req, res, params, user) => {
  const data = db.load();
  const reqObj = data.pointsRequests.find(r => r.id === params.id);
  if (!reqObj) return sendJson(res, 404, { error: 'Request not found' });
  const body = await readBody(req);
  if (body.status && ['approved', 'rejected', 'pending'].includes(body.status)) {
    reqObj.status = body.status;
    reqObj.resolvedBy = user.username;
    reqObj.resolvedAt = new Date().toISOString();
  }
  if (body.resolutionNote !== undefined) reqObj.resolutionNote = body.resolutionNote;
  db.addAudit(data, { userId: user.id, username: user.username, role: user.role, action: 'resolve_points_request', target: `${reqObj.id} -> ${reqObj.status}` });
  db.save(data);
  sendJson(res, 200, { pointsRequest: reqObj });
}, { auth: true, roles: ['admin', 'superadmin'] });

// ---------------------------------------------------------------------------
// USERS / ACCOUNTS  (creation is superadmin/admin only — no self sign-up)
// ---------------------------------------------------------------------------

route('GET', '/api/users', (req, res) => {
  const data = db.load();
  sendJson(res, 200, { users: data.users.map(publicUser) });
}, { auth: true, roles: ['admin', 'superadmin'] });

route('POST', '/api/users', async (req, res, params, user) => {
  const body = await readBody(req);
  const required = ['username', 'password', 'name', 'role'];
  for (const f of required) {
    if (!body[f]) return sendJson(res, 400, { error: `${f} is required` });
  }
  if (!['agent', 'partner', 'admin', 'superadmin'].includes(body.role)) {
    return sendJson(res, 400, { error: 'Invalid role' });
  }
  if (user.role === 'admin' && (body.role === 'admin' || body.role === 'superadmin')) {
    return sendJson(res, 403, { error: 'Only a super admin can create admin or super admin accounts' });
  }
  if (body.role === 'partner' && !body.partnerId) {
    return sendJson(res, 400, { error: 'partnerId is required for a partner account' });
  }
  const data = db.load();
  const username = body.username.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
    return sendJson(res, 400, { error: 'Username must be a valid email address, since it\'s used to deliver password-reset codes' });
  }
  if (data.users.some(u => u.username === username)) {
    return sendJson(res, 409, { error: 'That username is already taken' });
  }
  const { salt, hash } = db.hashPassword(body.password);
  const newUser = {
    id: db.uid('user'),
    username,
    name: body.name,
    role: body.role,
    partnerId: body.role === 'partner' ? body.partnerId : null,
    canViewFootprints: body.role === 'admin' ? (body.canViewFootprints !== false) : false,
    salt, hash,
    active: true,
    createdAt: new Date().toISOString()
  };
  data.users.push(newUser);
  db.addAudit(data, { userId: user.id, username: user.username, role: user.role, action: 'create_account', target: `${newUser.username} (${newUser.role})` });
  db.save(data);
  sendJson(res, 201, { user: publicUser(newUser) });
}, { auth: true, roles: ['admin', 'superadmin'] });

route('PUT', '/api/users/:id', async (req, res, params, user) => {
  const data = db.load();
  const target = data.users.find(u => u.id === params.id);
  if (!target) return sendJson(res, 404, { error: 'User not found' });
  if (user.role === 'admin' && target.id !== user.id && (target.role === 'admin' || target.role === 'superadmin')) {
    return sendJson(res, 403, { error: 'Only a super admin can modify admin or super admin accounts' });
  }
  const body = await readBody(req);
  if (body.name !== undefined) target.name = body.name;
  if (body.active !== undefined) target.active = !!body.active;
  if (body.partnerId !== undefined) target.partnerId = body.partnerId;
  if (body.canViewFootprints !== undefined) target.canViewFootprints = !!body.canViewFootprints;
  if (body.password) {
    const { salt, hash } = db.hashPassword(body.password);
    target.salt = salt; target.hash = hash;
  }
  db.addAudit(data, { userId: user.id, username: user.username, role: user.role, action: 'edit_account', target: target.username });
  db.save(data);
  sendJson(res, 200, { user: publicUser(target) });
}, { auth: true, roles: ['admin', 'superadmin'] });

route('DELETE', '/api/users/:id', (req, res, params, user) => {
  const data = db.load();
  const idx = data.users.findIndex(u => u.id === params.id);
  if (idx === -1) return sendJson(res, 404, { error: 'User not found' });
  const target = data.users[idx];
  if (user.role === 'admin' && (target.role === 'admin' || target.role === 'superadmin')) {
    return sendJson(res, 403, { error: 'Only a super admin can remove admin or super admin accounts' });
  }
  if (target.id === user.id) return sendJson(res, 400, { error: "You can't delete your own account" });
  data.users.splice(idx, 1);
  db.addAudit(data, { userId: user.id, username: user.username, role: user.role, action: 'delete_account', target: target.username });
  db.save(data);
  sendJson(res, 200, { ok: true });
}, { auth: true, roles: ['admin', 'superadmin'] });

// ---------------------------------------------------------------------------
// AUDIT LOG ("footprints")
// ---------------------------------------------------------------------------

route('GET', '/api/audit', (req, res, params, user) => {
  const allowed = user.role === 'superadmin' || (user.role === 'admin' && user.canViewFootprints);
  if (!allowed) return sendJson(res, 403, { error: 'You do not have permission to view the footprints log' });
  const data = db.load();
  sendJson(res, 200, { auditLog: data.auditLog });
}, { auth: true, roles: ['admin', 'superadmin'] });

// ---------------------------------------------------------------------------
// static file serving
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(PUBLIC_DIR, filePath);
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(full, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(full);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---------------------------------------------------------------------------
// server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname.startsWith('/api/')) {
    const matched = matchRoute(req.method, pathname);
    if (!matched) return sendJson(res, 404, { error: 'Unknown API route' });

    let user = null;
    if (matched.opts.auth) {
      user = currentUser(req);
      if (!user) return sendJson(res, 401, { error: 'Please sign in' });
      if (matched.opts.roles && !matched.opts.roles.includes(user.role)) {
        return sendJson(res, 403, { error: 'You do not have permission to do that' });
      }
    }

    try {
      await matched.handler(req, res, matched.params, user, parsed.query);
    } catch (e) {
      console.error(e);
      sendJson(res, 500, { error: 'Server error: ' + e.message });
    }
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  db.load(); // seed on first boot
  console.log(`Scene+ Partner & Agent Offers Portal running at http://localhost:${PORT}`);
});

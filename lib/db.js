// lib/db.js
// Tiny zero-dependency JSON "database". Good enough for a prototype /
// internal tool; swap for Postgres/Mongo later without touching the routes
// much since everything goes through the functions below.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
}

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function seed() {
  const subBrand = (id, name, logo) => ({ id, name, logo: logo || null });

  const partners = [
    {
      id: 'empire',
      name: 'Empire',
      colour: '#e01a2b',
      logo: '/img/empire.png',
      subBrands: [
        subBrand('freshco', 'FreshCo', '/img/freshco.png'),
        subBrand('foodland-coop', 'Foodland & Co-op', '/img/foodland-coop.png'),
        subBrand('sobeys', 'Sobeys', '/img/sobeys.jpg'),
        subBrand('safeway', 'Safeway', '/img/safeway.png'),
        subBrand('chalo-freshco', 'Chalo FreshCo', '/img/chalo-freshco.png'),
        subBrand('iga-rachelle-bery', 'IGA & Rachelle Béry', '/img/iga-rachelle-bery.jpeg'),
        subBrand('voila', 'Voilà', '/img/voila.png'),
        subBrand('thrifty-foods', 'Thrifty Foods', '/img/thrifty-foods.png'),
        subBrand('les-marches-tradition', 'Les Marchés Tradition', '/img/les-marches-tradition.jpeg')
      ]
    },
    { id: 'cineplex', name: 'Cineplex', colour: '#0d3b66', logo: '/img/cineplex.png', subBrands: [] },
    { id: 'scotiabank', name: 'Scotiabank', colour: '#ec111a', logo: '/img/scotiabank.png', subBrands: [] },
    { id: 'shell', name: 'Shell Canada', colour: '#f5c518', logo: '/img/shell.png', subBrands: [] },
    { id: 'sceneplus-travel', name: 'Scene+ Travel powered by Expedia', colour: '#f2a900', logo: '/img/sceneplus-travel.png', subBrands: [] },
    { id: 'tangerine', name: 'Tangerine', colour: '#f47920', logo: '/img/tangerine.png', subBrands: [] },
    { id: 'home-hardware', name: 'Home Hardware', colour: '#c8102e', logo: '/img/home-hardware.png', subBrands: [] },
    {
      id: 'recipe', name: 'Recipe Unlimited', colour: '#7a1f1f', logo: '/img/recipe.png',
      subBrands: [
        subBrand('harveys', "Harvey's", '/img/harveys.png'),
        subBrand('swiss-chalet', 'Swiss Chalet', '/img/swiss-chalet.png'),
        subBrand('east-side-marios', "East Side Mario's", '/img/east-side-marios.png'),
        subBrand('montanas', "Montana's", '/img/montanas.jpeg'),
        subBrand('bier-markt', 'Bier Markt', '/img/bier-markt.png'),
        subBrand('kelseys', 'Kelseys', '/img/kelseys.png'),
        subBrand('st-hubert', 'St-Hubert', '/img/st-hubert.png'),
        subBrand('the-keg', 'The Keg Steakhouse & Bar', '/img/the-keg.jpg'),
        subBrand('new-york-fries', 'New York Fries', '/img/new-york-fries.jpeg'),
        subBrand('original-joes', "Original Joe's", '/img/original-joes.jpeg'),
        subBrand('state-main', 'State & Main', '/img/state-main.jpeg'),
        subBrand('elephant-castle', 'Elephant & Castle', '/img/elephant-castle.png'),
        subBrand('burgers-priest', "The Burger's Priest", '/img/burgers-priest.png'),
        subBrand('pickle-barrel', 'The Pickle Barrel', '/img/pickle-barrel.png'),
        subBrand('fresh-kitchen', 'Fresh Kitchen + Juice Bar', '/img/fresh-kitchen.png'),
        subBrand('landing-group', 'The Landing Group of Restaurants', '/img/landing-group.png'),
        subBrand('blanco-cantina', 'Blanco Cantina', '/img/blanco-cantina.jpg'),
        subBrand('anejo', 'Añejo', '/img/anejo.jpeg')
      ]
    },
    {
      id: 'pharmacies', name: 'Pharmacies', colour: '#2e7d32',
      subBrands: [
        subBrand('lawtons-drugs', 'Lawtons Drugs', '/img/lawtons-drugs.png'),
        subBrand('sobeys-pharmacy', 'Sobeys Pharmacy', '/img/sobeys.jpg'),
        subBrand('freshco-pharmacy', 'FreshCo Pharmacy', '/img/freshco.png'),
        subBrand('safeway-pharmacy', 'Safeway Pharmacy', '/img/safeway.png'),
        subBrand('thrifty-foods-pharmacy', 'Thrifty Foods Pharmacy', '/img/thrifty-foods.png')
      ]
    },
    { id: 'rakuten', name: 'Rakuten', colour: '#bf0000', logo: '/img/rakuten.jpeg', subBrands: [] }
  ];

  const offerCategories = ['targeted', 'personalized', 'sceneplus', 'partner'];

  const offers = [];
  const sample = {
    empire: 'Earn 20x points per litre on select items',
    cineplex: 'Earn double points on concession purchases',
    scotiabank: 'Earn 5x points on gas and grocery purchases with Scotia Scene+ Visa',
    shell: 'Earn 5 points per litre of fuel',
    'sceneplus-travel': 'Earn points on hotel bookings through Scene+ Travel',
    'home-hardware': 'Earn bonus points on paint and hardware purchases',
    recipe: 'Earn 15 points per $1 spent at participating restaurants',
    pharmacies: 'Earn bonus points on prescription transfers',
    rakuten: 'Earn cash back plus Scene+ points on online shopping'
  };

  for (const p of partners) {
    if (p.subBrands.length) {
      // Offers live at the sub-brand level for partners that have sub-brands.
      for (const sb of p.subBrands) {
        offerCategories.forEach((cat, i) => {
          offers.push({
            id: uid('offer'),
            partnerId: p.id,
            subBrandId: sb.id,
            category: cat,
            title: `${sb.name} – ${cat === 'sceneplus' ? 'Scene+' : cat.charAt(0).toUpperCase() + cat.slice(1)} Offer`,
            description: sample[p.id] || 'Members earn bonus Scene+ points on qualifying purchases.',
            termsAndConditions: `Offer valid at participating ${sb.name} locations only. Bonus points post within 10 business days of a qualifying purchase. Not combinable with other bonus point offers unless stated. Scene+ membership must be linked at time of purchase. Points value and offer window subject to change without notice. See in-store or partner terms for full details.`,
            pointsValue: (i + 1) * 5,
            startDate: '2026-06-01',
            endDate: '2026-12-31',
            status: 'active',
            createdBy: 'seed',
            updatedAt: new Date().toISOString()
          });
        });
      }
    } else {
      offerCategories.forEach((cat, i) => {
        offers.push({
          id: uid('offer'),
          partnerId: p.id,
          subBrandId: null,
          category: cat,
          title: `${p.name} – ${cat === 'sceneplus' ? 'Scene+' : cat.charAt(0).toUpperCase() + cat.slice(1)} Offer`,
          description: sample[p.id] || 'Members earn bonus Scene+ points on qualifying purchases.',
          termsAndConditions: `Offer valid at participating ${p.name} locations only. Bonus points post within 10 business days of a qualifying purchase. Not combinable with other bonus point offers unless stated. Scene+ membership must be linked at time of purchase. Points value and offer window subject to change without notice. See in-store or partner terms for full details.`,
          pointsValue: (i + 1) * 5,
          startDate: '2026-06-01',
          endDate: '2026-12-31',
          status: 'active',
          createdBy: 'seed',
          updatedAt: new Date().toISOString()
        });
      });
    }
  }

  const users = [
    { username: 'superadmin', password: 'SuperAdmin123!', role: 'superadmin', name: 'Sam Superadmin', partnerId: null },
    { username: 'admin1', password: 'Admin123!', role: 'admin', name: 'Amara Admin', partnerId: null },
    { username: 'partner.empire', password: 'Partner123!', role: 'partner', name: 'Empire Marketing Team', partnerId: 'empire' },
    { username: 'partner.cineplex', password: 'Partner123!', role: 'partner', name: 'Cineplex Marketing Team', partnerId: 'cineplex' },
    { username: 'agent1', password: 'Agent123!', role: 'agent', name: 'Alex Agent', partnerId: null }
  ].map(u => {
    const { salt, hash } = hashPassword(u.password);
    return {
      id: uid('user'),
      username: u.username,
      name: u.name,
      role: u.role, // 'agent' | 'partner' | 'admin' | 'superadmin'
      partnerId: u.partnerId,
      salt,
      hash,
      active: true,
      createdAt: new Date().toISOString()
    };
  });

  return {
    partners,
    offers,
    users,
    pointsRequests: [],
    auditLog: [],
    _seedNote: 'Demo passwords are printed in the server console on first run — change them before any real use.'
  };
}

let cache = null;

function load() {
  if (cache) return cache;
  if (!fs.existsSync(DB_PATH)) {
    cache = seed();
    save(cache);
    console.log('\n[scene-plus-portal] Seeded demo database with these accounts (username / password):');
    console.log('  superadmin      / SuperAdmin123!');
    console.log('  admin1          / Admin123!');
    console.log('  partner.empire  / Partner123!   (Empire dashboard)');
    console.log('  partner.cineplex/ Partner123!   (Cineplex dashboard)');
    console.log('  agent1          / Agent123!\n');
  } else {
    cache = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  }
  return cache;
}

function save(data) {
  cache = data;
  // Vercel filesystem is read-only — skip disk write.
  // Data resets on each cold start; swap for KV/Postgres for persistence.
}

function addAudit(db, { userId, username, role, action, target }) {
  db.auditLog.unshift({
    id: uid('log'),
    at: new Date().toISOString(),
    userId, username, role, action, target
  });
  db.auditLog = db.auditLog.slice(0, 500); // keep it bounded
}

module.exports = { load, save, hashPassword, verifyPassword, uid, addAudit };

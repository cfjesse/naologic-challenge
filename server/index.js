const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());

/* ── In-Memory Data Storage ── */
let settings = { timeScale: 'Day', theme: 'light' };
let workCenters = [
  { docId: 'wc-1', docType: 'workCenter', data: { name: 'Extrusion Line A', isDefault: true } },
  { docId: 'wc-2', docType: 'workCenter', data: { name: 'CNC Machine 1', isDefault: true } },
  { docId: 'wc-3', docType: 'workCenter', data: { name: 'Assembly Station', isDefault: true } },
  { docId: 'wc-4', docType: 'workCenter', data: { name: 'Quality Control', isDefault: true } },
  { docId: 'wc-5', docType: 'workCenter', data: { name: 'Packaging Line', isDefault: true } },
];
let workOrders = [];

// Helper to generate random orders (same logic as before)
function generateInitialMockData() {
  const orders = [];
  const now = new Date();

  // +/- 3 months window
  const minDate = new Date(now);
  minDate.setMonth(now.getMonth() - 3);

  const maxDate = new Date(now);
  maxDate.setMonth(now.getMonth() + 3);

  const totalDaysSpan = Math.floor((maxDate - minDate) / (1000 * 60 * 60 * 24));

  const titles = [
    'Omega Forge', 'Titanium Weld', 'Cyberdyne Systems',
    'Mars Rover Chassis', 'Nano Coating', 'Fusion Core V4',
    'Quantum Stabilizer', 'Flux Capacitor', 'Positron Matrix',
    'Hydraulic Press', 'Laser Cutter', 'Assembly Unit 7'
  ];

  const statuses = ['open', 'in-progress', 'complete', 'blocked'];
  const wcIds = workCenters.map(c => c.docId);

  // Track occupied slots per work center to prevent overlaps
  const occupied = {};
  wcIds.forEach(id => occupied[id] = []);

  let createdCount = 0;
  let attempts = 0;
  const targetOrders = 20;

  while (createdCount < targetOrders && attempts < 200) {
    attempts++;
    const wcId = wcIds[Math.floor(Math.random() * wcIds.length)];
    const durationDays = Math.floor(Math.random() * 15) + 7;
    const randomOffset = Math.floor(Math.random() * (totalDaysSpan - durationDays));

    const start = new Date(minDate);
    start.setDate(start.getDate() + randomOffset);

    const end = new Date(start);
    end.setDate(start.getDate() + durationDays);

    const startMs = start.getTime();
    const endMs = end.getTime();

    const hasOverlap = occupied[wcId].some(slot => (startMs < slot.endMs && endMs > slot.startMs));

    if (!hasOverlap) {
      orders.push({
        docId: uuidv4(),
        docType: 'workOrder',
        data: {
          name: `${titles[Math.floor(Math.random() * titles.length)]} #${createdCount + 1001}`,
          workCenterId: wcId,
          status: statuses[Math.floor(Math.random() * statuses.length)],
          startDate: start.toISOString().split('T')[0],
          endDate: end.toISOString().split('T')[0]
        }
      });
      occupied[wcId].push({ startMs, endMs });
      createdCount++;
    }
  }
  return orders;
}

// Initialize memory
workOrders = generateInitialMockData();

/* ── Settings Routes ── */
app.get('/api/settings', (req, res) => {
  res.json(settings);
});

app.post('/api/settings', (req, res) => {
  settings = { ...settings, ...req.body };
  res.json(settings);
});

/* ── Work Centers Routes ── */
app.get('/api/work-centers', (req, res) => {
  res.json(workCenters);
});

app.put('/api/work-centers/:id', (req, res) => {
  const idx = workCenters.findIndex(c => c.docId === req.params.id);
  if (idx !== -1) {
    workCenters[idx] = { ...workCenters[idx], data: { ...workCenters[idx].data, ...req.body } };
    res.sendStatus(200);
  } else {
    res.status(404).send('Center not found');
  }
});

/* ── Work Orders Routes ── */
app.get('/api/orders', (req, res) => {
  res.json(workOrders);
});

app.post('/api/orders', (req, res) => {
  const newOrder = req.body;
  if (!newOrder.docId) newOrder.docId = uuidv4();
  workOrders.push(newOrder);
  res.json(newOrder);
});

app.put('/api/orders/:id', (req, res) => {
  const idx = workOrders.findIndex(o => o.docId === req.params.id);
  if (idx !== -1) {
    const existing = workOrders[idx];
    workOrders[idx] = { ...existing, data: { ...existing.data, ...req.body } };
    res.sendStatus(200);
  } else {
    res.status(404).send('Order not found');
  }
});

app.delete('/api/orders/:id', (req, res) => {
  const initialLen = workOrders.length;
  workOrders = workOrders.filter(o => o.docId !== req.params.id);
  if (workOrders.length !== initialLen) {
    res.sendStatus(200);
  } else {
    res.status(404).send('Order not found');
  }
});

/* ── Auth Routes (Mock) ── */
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'admin') {
    res.json({ success: true, user: { username: 'Admin', role: 'admin' } });
  } else if (username === 'user' && password === 'user') {
    res.json({ success: true, user: { username: 'User', role: 'user' } });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

app.listen(port, () => {
  console.log(`ERP Server (Session Memory Only) running at http://localhost:${port}`);
});

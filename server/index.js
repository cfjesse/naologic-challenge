const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 3000;
const settingsFile = path.join(__dirname, 'settings.json');
const ordersFile = path.join(__dirname, 'orders.json');

app.use(cors());
app.use(bodyParser.json());

// Initialize settings file if not exists
if (!fs.existsSync(settingsFile)) {
  fs.writeFileSync(settingsFile, JSON.stringify({ timeScale: 'Day', theme: 'light' }, null, 2));
}

// Helper to generate random orders
function generateRandomOrders() {
  const orders = [];
  const now = new Date();

  // +/- 3 months
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
  const wcIds = ['wc-1', 'wc-2', 'wc-3', 'wc-4', 'wc-5'];
  const statuses = ['open', 'in-progress', 'complete', 'blocked'];

  // Track occupied slots per work center to prevent overlaps
  const occupied = {}; // { 'wc-1': [{startMs, endMs}] }
  wcIds.forEach(id => occupied[id] = []);

  // Try to generate 20 orders
  let createdCount = 0;
  let attempts = 0;
  const targetOrders = 20;

  while (createdCount < targetOrders && attempts < 200) {
    attempts++;

    // Random WC
    const wcId = wcIds[Math.floor(Math.random() * wcIds.length)];

    // Random duration: 7 to 21 days
    const durationDays = Math.floor(Math.random() * 15) + 7;

    // Random start date within range
    const randomOffset = Math.floor(Math.random() * (totalDaysSpan - durationDays));
    const start = new Date(minDate);
    start.setDate(start.getDate() + randomOffset);

    const end = new Date(start);
    end.setDate(start.getDate() + durationDays);

    const startMs = start.getTime();
    const endMs = end.getTime();

    // Check overlap
    const hasOverlap = occupied[wcId].some(slot => {
      // Overlap if (start1 < end2) and (end1 > start2)
      return (startMs < slot.endMs && endMs > slot.startMs);
    });

    if (!hasOverlap) {
      // Create order
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

// Initialize orders file if not exists
if (!fs.existsSync(ordersFile)) {
  const defaultOrders = generateRandomOrders();
  fs.writeFileSync(ordersFile, JSON.stringify(defaultOrders, null, 2));
}
else {
  try {
    const existing = JSON.parse(fs.readFileSync(ordersFile, 'utf8'));
    // If it has old static data ( <= 2 items and Name "Server Order 1") OR old randomization ( "(Server) #" name format)
    // we should upgrade it to the new non-overlapping logic.
    const isOldStatic = existing.length <= 2 && existing.some(o => o.data.name === 'Server Order 1');
    const isOldRandom = existing.some(o => o.data.name.includes('(Server) #'));

    if (isOldStatic || isOldRandom) {
      console.log('Upgrading mock data to strictly randomized non-overlapping data...');
      fs.writeFileSync(ordersFile, JSON.stringify(generateRandomOrders(), null, 2));
    }
  } catch (e) { }
}

// Routes
app.get('/api/settings', (req, res) => {
  try {
    if (fs.existsSync(settingsFile)) {
      const data = fs.readFileSync(settingsFile, 'utf8');
      res.json(JSON.parse(data));
    } else {
      res.json({ timeScale: 'Day', theme: 'light' });
    }
  } catch (err) {
    res.status(500).send('Error reading settings');
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const current = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {};
    const updated = { ...current, ...req.body };
    fs.writeFileSync(settingsFile, JSON.stringify(updated, null, 2));
    res.json(updated);
  } catch (err) {
    res.status(500).send('Error writing settings');
  }
});

// Orders Routes
app.get('/api/orders', (req, res) => {
  try {
    if (fs.existsSync(ordersFile)) {
      const data = fs.readFileSync(ordersFile, 'utf8');
      res.json(JSON.parse(data));
    } else {
      res.json([]);
    }
  } catch (err) {
    res.status(500).send('Error reading orders');
  }
});

app.post('/api/orders', (req, res) => {
  try {
    const orders = fs.existsSync(ordersFile) ? JSON.parse(fs.readFileSync(ordersFile, 'utf8')) : [];
    const newOrder = req.body;
    // ensure docId
    if (!newOrder.docId) newOrder.docId = uuidv4();

    orders.push(newOrder);
    fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));
    res.json(newOrder);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creating order');
  }
});

app.put('/api/orders/:id', (req, res) => {
  try {
    const orders = JSON.parse(fs.readFileSync(ordersFile, 'utf8'));
    const idx = orders.findIndex(o => o.docId === req.params.id);
    if (idx !== -1) {
      const existing = orders[idx];
      // Merge incoming data (partial) into existing data object
      // If req.body is the 'data' part or duplicate structure, handle it.
      // ApiService.updateWorkOrder sends `data: Partial<WorkOrderDocument['data']>`
      orders[idx] = { ...existing, data: { ...existing.data, ...req.body } };
      fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));
      res.sendStatus(200);
    } else {
      res.status(404).send('Order not found');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Error updating order');
  }
});

app.delete('/api/orders/:id', (req, res) => {
  try {
    let orders = JSON.parse(fs.readFileSync(ordersFile, 'utf8'));
    const initialLen = orders.length;
    orders = orders.filter(o => o.docId !== req.params.id);
    if (orders.length !== initialLen) {
      fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));
      res.sendStatus(200);
    } else {
      res.status(404).send('Order not found');
    }
  } catch (err) {
    res.status(500).send('Error deleting order');
  }
});

// Mock Authentication (Optional if we want backend auth)
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
  console.log(`ERP Server running at http://localhost:${port}`);
});

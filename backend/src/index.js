require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET;

// --- Auth Middleware ---
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// --- Socket.io Realtime ---
io.on('connection', (socket) => {
  socket.on('joinProject', (projectId) => socket.join(projectId));
  socket.on('leaveProject', (projectId) => socket.leave(projectId));
});

// --- Auth Routes ---
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  try {
    const user = await prisma.user.create({ data: { email, password: hash } });
    res.json({ id: user.id, email: user.email });
  } catch {
    res.status(400).json({ error: 'Email already exists' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

// --- User Projects (owned or member) ---
app.get('/api/projects', auth, async (req, res) => {
  const userId = req.user.id;
  // Ambil project yang dimiliki user
  const owned = await prisma.project.findMany({ where: { ownerId: userId } });
  // Ambil project yang user jadi member
  const member = await prisma.membership.findMany({
    where: { userId },
    include: { project: true }
  });
  // Gabungkan dan hilangkan duplikat
  const allProjects = [...owned, ...member.map(m => m.project)]
    .filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i);
  res.json(allProjects);
});

// --- Create Project ---
app.post('/api/projects', auth, async (req, res) => {
  const { name } = req.body;
  const project = await prisma.project.create({
    data: { name, ownerId: req.user.id }
  });
  // Emit realtime event to all clients
  io.emit('projectUpdate', { type: 'create', project });
  res.json(project);
});

// --- Project Detail (with tasks, members) ---
app.get('/api/projects/:id', auth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      tasks: { include: { assignee: true } },
      memberships: { include: { user: true } },
      owner: true
    }
  });
  if (!project) return res.status(404).json({ error: 'Not found' });
  // Hanya owner atau member yang bisa akses
  if (project.ownerId !== userId &&
      !project.memberships.some(m => m.userId === userId))
    return res.status(403).json({ error: 'Forbidden' });
  res.json(project);
});

// --- Invite Member ---
app.post('/api/projects/:id/invite', auth, async (req, res) => {
  const { id } = req.params;
  const { email } = req.body;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project || project.ownerId !== req.user.id)
    return res.status(403).json({ error: 'Forbidden' });
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(404).json({ error: 'User not found' });
  await prisma.membership.upsert({
    where: { userId_projectId: { userId: user.id, projectId: id } },
    update: {},
    create: { userId: user.id, projectId: id }
  });
  res.json({ success: true });
});

// --- Delete Project ---
app.delete('/api/projects/:id', auth, async (req, res) => {
  const { id } = req.params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project || project.ownerId !== req.user.id)
    return res.status(403).json({ error: 'Forbidden' });
  await prisma.project.delete({ where: { id } });
  res.json({ success: true });
});

// --- Tasks CRUD ---
app.post('/api/projects/:id/tasks', auth, async (req, res) => {
  const { id } = req.params;
  const { title, description, status, assigneeId } = req.body;
  // Only project owner/member can add
  const project = await prisma.project.findUnique({
    where: { id },
    include: { memberships: true }
  });
  if (!project) return res.status(404).json({ error: 'Not found' });
  const userId = req.user.id;
  if (project.ownerId !== userId &&
      !project.memberships.some(m => m.userId === userId))
    return res.status(403).json({ error: 'Forbidden' });
  const task = await prisma.task.create({
    data: { title, description, status, projectId: id, assigneeId }
  });
  io.to(id).emit('taskUpdate', { type: 'create', task });
  res.json(task);
});

app.patch('/api/tasks/:taskId', auth, async (req, res) => {
  const { taskId } = req.params;
  const { title, description, status, assigneeId } = req.body;
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return res.status(404).json({ error: 'Not found' });
  // Only project owner/member can update
  const project = await prisma.project.findUnique({
    where: { id: task.projectId },
    include: { memberships: true }
  });
  const userId = req.user.id;
  if (project.ownerId !== userId &&
      !project.memberships.some(m => m.userId === userId))
    return res.status(403).json({ error: 'Forbidden' });
  const updated = await prisma.task.update({
    where: { id: taskId },
    data: { title, description, status, assigneeId }
  });
  io.to(task.projectId).emit('taskUpdate', { type: 'update', task: updated });
  res.json(updated);
});

app.delete('/api/tasks/:taskId', auth, async (req, res) => {
  const { taskId } = req.params;
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return res.status(404).json({ error: 'Not found' });
  const project = await prisma.project.findUnique({
    where: { id: task.projectId },
    include: { memberships: true }
  });
  const userId = req.user.id;
  if (project.ownerId !== userId &&
      !project.memberships.some(m => m.userId === userId))
    return res.status(403).json({ error: 'Forbidden' });
  await prisma.task.delete({ where: { id: taskId } });
  io.to(task.projectId).emit('taskUpdate', { type: 'delete', taskId });
  res.json({ success: true });
});

// --- Task Analytics Chart ---
app.get('/api/projects/:id/analytics', auth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const project = await prisma.project.findUnique({
    where: { id },
    include: { memberships: true }
  });
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (project.ownerId !== userId &&
      !project.memberships.some(m => m.userId === userId))
    return res.status(403).json({ error: 'Forbidden' });
  const statuses = await prisma.task.groupBy({
    by: ['status'],
    where: { projectId: id },
    _count: { status: true }
  });
  res.json(statuses.map(s => ({ status: s.status, count: s._count.status })));
});

// --- Export Project Data ---
app.get('/api/projects/:id/export', auth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      tasks: true,
      memberships: { include: { user: true } }
    }
  });
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (project.ownerId !== userId &&
      !project.memberships.some(m => m.userId === userId))
    return res.status(403).json({ error: 'Forbidden' });
  res.setHeader('Content-Disposition', `attachment; filename=project-${id}.json`);
  res.json(project);
});

// --- Endpoint untuk mengambil semua project tanpa filter user ---
app.get('/api/all-projects', async (req, res) => {
  const projects = await prisma.project.findMany();
  res.json(projects);
});

// Endpoint untuk mengambil email user dari array id
app.post('/api/users/emails', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.json({});
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, email: true }
  });
  const result = {};
  users.forEach(u => { result[u.id] = u.email; });
  res.json(result);
});

// Hapus member dari project (hanya owner yang boleh)
app.delete('/api/projects/:id/member/:userId', auth, async (req, res) => {
  const { id, userId } = req.params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (project.ownerId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  // Tidak boleh hapus owner sendiri
  if (userId === project.ownerId) return res.status(400).json({ error: 'Cannot remove owner' });
  await prisma.membership.deleteMany({ where: { projectId: id, userId } });
  res.json({ success: true });
});

// Edit project name (hanya owner)
app.patch('/api/projects/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (project.ownerId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const updated = await prisma.project.update({ where: { id }, data: { name } });
  res.json(updated);
});

// --- Start Server ---
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});

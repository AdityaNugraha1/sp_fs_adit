import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const app = new Hono();
// Only the deployed app and local dev may call this API from a browser.
const DEFAULT_ORIGINS = 'https://projectflow.keviinnn.my.id,http://localhost:3000';
app.use('*', cors({
  origin: (origin, c) => {
    const allowed = (c.env.ALLOWED_ORIGINS || DEFAULT_ORIGINS)
      .split(',').map(v => v.trim()).filter(Boolean);
    return allowed.includes(origin) ? origin : null;
  },
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

// --- Input validation ---
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(8).max(128);
const nameSchema = z.string().trim().min(1).max(200);
const taskStatusSchema = z.enum(['todo', 'in_progress', 'done']);

const registerSchema = z.object({ email: emailSchema, password: passwordSchema });
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
const projectCreateSchema = z.object({ name: nameSchema });
const projectUpdateSchema = z.object({ name: nameSchema });
const inviteSchema = z.object({ email: emailSchema });
const emailsSchema = z.object({ ids: z.array(z.string().uuid()).max(100) });
const taskCreateSchema = z.object({
  title: nameSchema,
  description: z.string().max(5000).optional().default(''),
  status: taskStatusSchema.optional().default('todo'),
  assigneeId: z.string().uuid().nullable().optional(),
});
const taskUpdateSchema = z.object({
  title: nameSchema.optional(),
  description: z.string().max(5000).optional(),
  status: taskStatusSchema.optional(),
  assigneeId: z.string().uuid().nullable().optional(),
});

async function parseBody(c, schema) {
  let raw;
  try { raw = await c.req.json(); }
  catch { return { ok: false, res: c.json({ error: 'Invalid JSON body' }, 400) }; }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, res: c.json({ error: parsed.error.issues[0].message }, 400) };
  return { ok: true, data: parsed.data };
}

// --- DB & auth helpers ---
// Neon's stateless HTTP driver: each call is a fresh fetch bound to the
// current request. A cached Pool/Client would hold I/O created under another
// request, which the Workers runtime rejects ("Cannot perform I/O on behalf of
// a different request"), so per-isolate pooling is both unnecessary and broken.
let cachedSql = null, cachedSqlUrl = null;
const getSql = (env) => {
  if (!cachedSql || cachedSqlUrl !== env.DATABASE_URL) {
    cachedSql = neon(env.DATABASE_URL);
    cachedSqlUrl = env.DATABASE_URL;
  }
  return cachedSql;
};
const getSecret = (env) => new TextEncoder().encode(env.JWT_SECRET);

async function signToken(secret, payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(secret);
}

async function auth(c, next) {
  const token = c.req.header('authorization')?.split(' ')[1];
  if (!token) return c.json({ error: 'No token' }, 401);
  try {
    const { payload } = await jwtVerify(token, getSecret(c.env));
    c.set('user', payload);
    return next();
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }
}

const getUser = (c) => c.get('user');

// --- Reusable project access check: owner or member ---
async function canAccess(sql, projectId, userId) {
  const rows = await sql`
    SELECT EXISTS(
      SELECT 1 FROM "Project" WHERE id=${projectId} AND "ownerId"=${userId}
      UNION ALL
      SELECT 1 FROM "Membership" WHERE "projectId"=${projectId} AND "userId"=${userId}
    ) AS ok`;
  return rows[0].ok;
}

// --- Auth ---
app.post('/api/register', async (c) => {
  const body = await parseBody(c, registerSchema);
  if (!body.ok) return body.res;
  const { email, password } = body.data;
  const hash = await bcrypt.hash(password, 10);
  const sql = getSql(c.env);
  try {
    const id = randomUUID();
    await sql`INSERT INTO "User" (id, email, password) VALUES (${id}, ${email}, ${hash})`;
    const token = await signToken(getSecret(c.env), { id, email });
    return c.json({ id, email, token });
  } catch (err) {
    if (err && err.code === '23505') return c.json({ error: 'Email already exists' }, 409);
    console.error('register failed', err);
    return c.json({ error: 'Could not create account' }, 500);
  }
});

app.post('/api/login', async (c) => {
  const body = await parseBody(c, loginSchema);
  if (!body.ok) return body.res;
  const { email, password } = body.data;
  const sql = getSql(c.env);
  const rows = await sql`SELECT * FROM "User" WHERE email=${email}`;
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password)))
    return c.json({ error: 'Invalid credentials' }, 401);
  const token = await signToken(getSecret(c.env), { id: user.id, email: user.email });
  return c.json({ token });
});

// --- Projects ---
app.get('/api/projects', auth, async (c) => {
  const { id: userId } = getUser(c);
  const sql = getSql(c.env);
  const owned = await sql`SELECT * FROM "Project" WHERE "ownerId"=${userId}`;
  const member = await sql`
    SELECT p.* FROM "Membership" m JOIN "Project" p ON p.id=m."projectId" WHERE m."userId"=${userId}`;
  const seen = new Set();
  const all = [...owned, ...member].filter(p => !seen.has(p.id) && seen.add(p.id));
  return c.json(all);
});

app.post('/api/projects', auth, async (c) => {
  const body = await parseBody(c, projectCreateSchema);
  if (!body.ok) return body.res;
  const { name } = body.data;
  const { id: userId } = getUser(c);
  const id = randomUUID();
  const sql = getSql(c.env);
  const rows = await sql`
    INSERT INTO "Project" (id, name, "ownerId") VALUES (${id}, ${name}, ${userId}) RETURNING *`;
  return c.json(rows[0]);
});

app.get('/api/projects/:id', auth, async (c) => {
  const { id } = c.req.param();
  const { id: userId } = getUser(c);
  const sql = getSql(c.env);
  const rows = await sql`SELECT * FROM "Project" WHERE id=${id}`;
  const project = rows[0];
  if (!project) return c.json({ error: 'Not found' }, 404);
  if (!(await canAccess(sql, id, userId))) return c.json({ error: 'Forbidden' }, 403);

  const tasks = await sql`
    SELECT t.*, u.id AS "assignee.id", u.email AS "assignee.email"
    FROM "Task" t LEFT JOIN "User" u ON u.id=t."assigneeId" WHERE t."projectId"=${id}`;
  const memberships = await sql`
    SELECT m.*, u.email AS "user.email" FROM "Membership" m JOIN "User" u ON u.id=m."userId" WHERE m."projectId"=${id}`;
  const owner = await sql`SELECT id, email FROM "User" WHERE id=${project.ownerId}`;

  project.tasks = tasks.map(r => ({
    ...r,
    assignee: r['assignee.id'] ? { id: r['assignee.id'], email: r['assignee.email'] } : null,
  }));
  delete project['assignee.id']; delete project['assignee.email'];
  project.memberships = memberships.map(m => ({
    id: m.id, createdAt: m.createdAt, updatedAt: m.updatedAt,
    user: { id: m.userId, email: m['user.email'] },
  }));
  project.owner = owner[0];
  return c.json(project);
});

app.post('/api/projects/:id/invite', auth, async (c) => {
  const { id } = c.req.param();
  const body = await parseBody(c, inviteSchema);
  if (!body.ok) return body.res;
  const { email } = body.data;
  const { id: userId } = getUser(c);
  const sql = getSql(c.env);
  const projRows = await sql`SELECT "ownerId" FROM "Project" WHERE id=${id}`;
  const project = projRows[0];
  if (!project || project.ownerId !== userId) return c.json({ error: 'Forbidden' }, 403);
  const user = await sql`SELECT id FROM "User" WHERE email=${email}`;
  // Same response whether or not the account exists, so this endpoint cannot
  // be used to probe which emails are registered.
  if (!user[0]) return c.json({ success: true });
  const memberId = randomUUID();
  await sql`
    INSERT INTO "Membership" (id, "userId", "projectId") VALUES (${memberId}, ${user[0].id}, ${id})
    ON CONFLICT ("userId", "projectId") DO NOTHING`;
  return c.json({ success: true });
});

app.delete('/api/projects/:id', auth, async (c) => {
  const { id } = c.req.param();
  const { id: userId } = getUser(c);
  const sql = getSql(c.env);
  const rows = await sql`SELECT "ownerId" FROM "Project" WHERE id=${id}`;
  if (!rows[0] || rows[0].ownerId !== userId) return c.json({ error: 'Forbidden' }, 403);
  await sql`DELETE FROM "Project" WHERE id=${id}`;
  return c.json({ success: true });
});

app.patch('/api/projects/:id', auth, async (c) => {
  const { id } = c.req.param();
  const body = await parseBody(c, projectUpdateSchema);
  if (!body.ok) return body.res;
  const { name } = body.data;
  const { id: userId } = getUser(c);
  const sql = getSql(c.env);
  const rows = await sql`SELECT "ownerId" FROM "Project" WHERE id=${id}`;
  if (!rows[0] || rows[0].ownerId !== userId) return c.json({ error: 'Forbidden' }, 403);
  const updated = await sql`UPDATE "Project" SET name=${name} WHERE id=${id} RETURNING *`;
  return c.json(updated[0]);
});

// --- Members ---
app.delete('/api/projects/:id/member/:userId', auth, async (c) => {
  const { id, userId: targetId } = c.req.param();
  const { id: userId } = getUser(c);
  const sql = getSql(c.env);
  const rows = await sql`SELECT "ownerId" FROM "Project" WHERE id=${id}`;
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  if (rows[0].ownerId !== userId) return c.json({ error: 'Forbidden' }, 403);
  if (targetId === rows[0].ownerId) return c.json({ error: 'Cannot remove owner' }, 400);
  await sql`DELETE FROM "Membership" WHERE "projectId"=${id} AND "userId"=${targetId}`;
  return c.json({ success: true });
});

// --- Tasks ---
app.post('/api/projects/:id/tasks', auth, async (c) => {
  const { id } = c.req.param();
  const body = await parseBody(c, taskCreateSchema);
  if (!body.ok) return body.res;
  const { title, description, status, assigneeId } = body.data;
  const { id: userId } = getUser(c);
  const sql = getSql(c.env);
  if (!(await canAccess(sql, id, userId))) return c.json({ error: 'Forbidden' }, 403);
  const taskId = randomUUID();
  const rows = await sql`
    INSERT INTO "Task" (id, title, description, status, "projectId", "assigneeId")
    VALUES (${taskId}, ${title}, ${description}, ${status ?? 'todo'}, ${id}, ${assigneeId ?? null})
    RETURNING *`;
  return c.json(rows[0]);
});

app.patch('/api/tasks/:taskId', auth, async (c) => {
  const { taskId } = c.req.param();
  const body = await parseBody(c, taskUpdateSchema);
  if (!body.ok) return body.res;
  const { title, description, status, assigneeId } = body.data;
  const { id: userId } = getUser(c);
  const sql = getSql(c.env);
  const rows = await sql`SELECT * FROM "Task" WHERE id=${taskId}`;
  const task = rows[0];
  if (!task) return c.json({ error: 'Not found' }, 404);
  if (!(await canAccess(sql, task.projectId, userId))) return c.json({ error: 'Forbidden' }, 403);
  const updated = await sql`
    UPDATE "Task" SET title=${title ?? task.title}, description=${description ?? task.description},
      status=${status ?? task.status}, "assigneeId"=${assigneeId ?? task.assigneeId}
    WHERE id=${taskId} RETURNING *`;
  return c.json(updated[0]);
});

app.delete('/api/tasks/:taskId', auth, async (c) => {
  const { taskId } = c.req.param();
  const { id: userId } = getUser(c);
  const sql = getSql(c.env);
  const rows = await sql`SELECT * FROM "Task" WHERE id=${taskId}`;
  const task = rows[0];
  if (!task) return c.json({ error: 'Not found' }, 404);
  if (!(await canAccess(sql, task.projectId, userId))) return c.json({ error: 'Forbidden' }, 403);
  await sql`DELETE FROM "Task" WHERE id=${taskId}`;
  return c.json({ success: true });
});

// --- Analytics & Export ---
app.get('/api/projects/:id/analytics', auth, async (c) => {
  const { id } = c.req.param();
  const { id: userId } = getUser(c);
  const sql = getSql(c.env);
  if (!(await canAccess(sql, id, userId))) return c.json({ error: 'Forbidden' }, 403);
  const rows = await sql`
    SELECT status, COUNT(*)::int AS count FROM "Task" WHERE "projectId"=${id} GROUP BY status`;
  return c.json(rows.map(r => ({ status: r.status, count: r.count })));
});

app.get('/api/projects/:id/export', auth, async (c) => {
  const { id } = c.req.param();
  const { id: userId } = getUser(c);
  const sql = getSql(c.env);
  if (!(await canAccess(sql, id, userId))) return c.json({ error: 'Forbidden' }, 403);
  const project = (await sql`SELECT * FROM "Project" WHERE id=${id}`)[0];
  const tasks = await sql`SELECT * FROM "Task" WHERE "projectId"=${id}`;
  const memberships = await sql`
    SELECT m.*, u.email FROM "Membership" m JOIN "User" u ON u.id=m."userId" WHERE m."projectId"=${id}`;
  c.header('Content-Disposition', `attachment; filename=project-${id}.json`);
  return c.json({ ...project, tasks, memberships });
});

// --- Directory ---
// Was public: leaked every project of every tenant. Now scoped to the caller.
app.get('/api/all-projects', auth, async (c) => {
  const { id: userId } = getUser(c);
  const sql = getSql(c.env);
  const rows = await sql`
    SELECT DISTINCT p.* FROM "Project" p
      LEFT JOIN "Membership" m ON m."projectId" = p.id
     WHERE p."ownerId" = ${userId} OR m."userId" = ${userId}
     ORDER BY p."createdAt" DESC`;
  return c.json(rows);
});

// Was public: unauthenticated email enumeration. Now requires auth, is capped,
// and only resolves ids that belong to projects the caller can already access.
app.post('/api/users/emails', auth, async (c) => {
  const body = await parseBody(c, emailsSchema);
  if (!body.ok) return body.res;
  const { ids } = body.data;
  if (!ids.length) return c.json({});
  const { id: userId } = getUser(c);
  const sql = getSql(c.env);
  // Only expose emails of people the caller shares a project with (as owner or
  // member).
  const visible = await sql`
    SELECT p."ownerId" AS uid FROM "Project" p
      LEFT JOIN "Membership" pm ON pm."projectId" = p.id
     WHERE p."ownerId" = ${userId} OR pm."userId" = ${userId}
    UNION
    SELECT m."userId" AS uid FROM "Membership" m
      JOIN "Project" p2 ON p2.id = m."projectId"
      LEFT JOIN "Membership" pm2 ON pm2."projectId" = p2.id
     WHERE p2."ownerId" = ${userId} OR pm2."userId" = ${userId}`;
  const visibleIds = new Set(visible.map(r => r.uid));
  const wanted = ids.filter(id => visibleIds.has(id));
  if (!wanted.length) return c.json({});
  const rows = await sql`SELECT id, email FROM "User" WHERE id = ANY(${wanted})`;
  const result = {};
  rows.forEach(u => { result[u.id] = u.email; });
  return c.json(result);
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal error' }, 500);
});

export default app;

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Pool } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';

const app = new Hono();
app.use('*', cors());

// --- DB & auth helpers ---
const getPool = (env) => new Pool({ connectionString: env.DATABASE_URL });
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
async function canAccess(client, projectId, userId) {
  const { rows } = await client.query(
    `SELECT EXISTS(
       SELECT 1 FROM "Project" WHERE id=$1 AND "ownerId"=$2
       UNION ALL
       SELECT 1 FROM "Membership" WHERE "projectId"=$1 AND "userId"=$2
     ) AS ok`, [projectId, userId]);
  return rows[0].ok;
}

// --- Auth ---
app.post('/api/register', async (c) => {
  const { email, password } = await c.req.json();
  if (!email || !password) return c.json({ error: 'Email and password required' }, 400);
  const hash = await bcrypt.hash(password, 10);
  const pool = getPool(c.env);
  try {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO "User" (id, email, password) VALUES ($1, $2, $3)`,
      [id, email, hash]);
    return c.json({ id, email });
  } catch {
    return c.json({ error: 'Email already exists' }, 400);
  } finally {
    await pool.end();
  }
});

app.post('/api/login', async (c) => {
  const { email, password } = await c.req.json();
  const pool = getPool(c.env);
  try {
    const { rows } = await pool.query(`SELECT * FROM "User" WHERE email=$1`, [email]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password)))
      return c.json({ error: 'Invalid credentials' }, 401);
    const token = await signToken(getSecret(c.env), { id: user.id, email: user.email });
    return c.json({ token });
  } finally {
    await pool.end();
  }
});

// --- Projects ---
app.get('/api/projects', auth, async (c) => {
  const { id: userId } = getUser(c);
  const pool = getPool(c.env);
  try {
    const owned = await pool.query(`SELECT * FROM "Project" WHERE "ownerId"=$1`, [userId]);
    const member = await pool.query(
      `SELECT p.* FROM "Membership" m JOIN "Project" p ON p.id=m."projectId" WHERE m."userId"=$1`,
      [userId]);
    const seen = new Set();
    const all = [...owned.rows, ...member.rows].filter(p => !seen.has(p.id) && seen.add(p.id));
    return c.json(all);
  } finally {
    await pool.end();
  }
});

app.post('/api/projects', auth, async (c) => {
  const { name } = await c.req.json();
  const { id: userId } = getUser(c);
  const id = randomUUID();
  const pool = getPool(c.env);
  try {
    const { rows } = await pool.query(
      `INSERT INTO "Project" (id, name, "ownerId") VALUES ($1, $2, $3) RETURNING *`,
      [id, name, userId]);
    return c.json(rows[0]);
  } finally {
    await pool.end();
  }
});

app.get('/api/projects/:id', auth, async (c) => {
  const { id } = c.req.param();
  const { id: userId } = getUser(c);
  const pool = getPool(c.env);
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`SELECT * FROM "Project" WHERE id=$1`, [id]);
      const project = rows[0];
      if (!project) return c.json({ error: 'Not found' }, 404);
      if (!(await canAccess(client, id, userId))) return c.json({ error: 'Forbidden' }, 403);

      const tasks = await client.query(
        `SELECT t.*, u.id AS "assignee.id", u.email AS "assignee.email"
         FROM "Task" t LEFT JOIN "User" u ON u.id=t."assigneeId" WHERE t."projectId"=$1`, [id]);
      const memberships = await client.query(
        `SELECT m.*, u.email AS "user.email" FROM "Membership" m JOIN "User" u ON u.id=m."userId" WHERE m."projectId"=$1`, [id]);
      const owner = await client.query(`SELECT id, email FROM "User" WHERE id=$1`, [project.ownerId]);

      project.tasks = tasks.rows.map(r => ({
        ...r,
        assignee: r['assignee.id'] ? { id: r['assignee.id'], email: r['assignee.email'] } : null,
      }));
      delete project['assignee.id']; delete project['assignee.email'];
      project.memberships = memberships.rows.map(m => ({
        id: m.id, createdAt: m.createdAt, updatedAt: m.updatedAt,
        user: { id: m.userId, email: m['user.email'] },
      }));
      project.owner = owner.rows[0];
      return c.json(project);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
});

app.post('/api/projects/:id/invite', auth, async (c) => {
  const { id } = c.req.param();
  const { email } = await c.req.json();
  const { id: userId } = getUser(c);
  const pool = getPool(c.env);
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`SELECT "ownerId" FROM "Project" WHERE id=$1`, [id]);
      const project = rows[0];
      if (!project || project.ownerId !== userId) return c.json({ error: 'Forbidden' }, 403);
      const user = await client.query(`SELECT id FROM "User" WHERE email=$1`, [email]);
      if (!user.rows[0]) return c.json({ error: 'User not found' }, 404);
      const memberId = randomUUID();
      await client.query(
        `INSERT INTO "Membership" (id, "userId", "projectId") VALUES ($1, $2, $3)
         ON CONFLICT ("userId", "projectId") DO NOTHING`,
        [memberId, user.rows[0].id, id]);
      return c.json({ success: true });
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
});

app.delete('/api/projects/:id', auth, async (c) => {
  const { id } = c.req.param();
  const { id: userId } = getUser(c);
  const pool = getPool(c.env);
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`SELECT "ownerId" FROM "Project" WHERE id=$1`, [id]);
      if (!rows[0] || rows[0].ownerId !== userId) return c.json({ error: 'Forbidden' }, 403);
      await client.query(`DELETE FROM "Project" WHERE id=$1`, [id]);
      return c.json({ success: true });
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
});

app.patch('/api/projects/:id', auth, async (c) => {
  const { id } = c.req.param();
  const { name } = await c.req.json();
  const { id: userId } = getUser(c);
  const pool = getPool(c.env);
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`SELECT "ownerId" FROM "Project" WHERE id=$1`, [id]);
      if (!rows[0] || rows[0].ownerId !== userId) return c.json({ error: 'Forbidden' }, 403);
      const updated = await client.query(
        `UPDATE "Project" SET name=$1 WHERE id=$2 RETURNING *`, [name, id]);
      return c.json(updated.rows[0]);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
});

// --- Members ---
app.delete('/api/projects/:id/member/:userId', auth, async (c) => {
  const { id, userId: targetId } = c.req.param();
  const { id: userId } = getUser(c);
  const pool = getPool(c.env);
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`SELECT "ownerId" FROM "Project" WHERE id=$1`, [id]);
      if (!rows[0]) return c.json({ error: 'Not found' }, 404);
      if (rows[0].ownerId !== userId) return c.json({ error: 'Forbidden' }, 403);
      if (targetId === rows[0].ownerId) return c.json({ error: 'Cannot remove owner' }, 400);
      await client.query(`DELETE FROM "Membership" WHERE "projectId"=$1 AND "userId"=$2`, [id, targetId]);
      return c.json({ success: true });
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
});

// --- Tasks ---
app.post('/api/projects/:id/tasks', auth, async (c) => {
  const { id } = c.req.param();
  const { title, description, status, assigneeId } = await c.req.json();
  const { id: userId } = getUser(c);
  const pool = getPool(c.env);
  try {
    const client = await pool.connect();
    try {
      if (!(await canAccess(client, id, userId))) return c.json({ error: 'Forbidden' }, 403);
      const taskId = randomUUID();
      const { rows } = await client.query(
        `INSERT INTO "Task" (id, title, description, status, "projectId", "assigneeId")
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [taskId, title, description, status ?? 'todo', id, assigneeId ?? null]);
      return c.json(rows[0]);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
});

app.patch('/api/tasks/:taskId', auth, async (c) => {
  const { taskId } = c.req.param();
  const { title, description, status, assigneeId } = await c.req.json();
  const { id: userId } = getUser(c);
  const pool = getPool(c.env);
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`SELECT * FROM "Task" WHERE id=$1`, [taskId]);
      const task = rows[0];
      if (!task) return c.json({ error: 'Not found' }, 404);
      if (!(await canAccess(client, task.projectId, userId))) return c.json({ error: 'Forbidden' }, 403);
      const updated = await client.query(
        `UPDATE "Task" SET title=$1, description=$2, status=$3, "assigneeId"=$4 WHERE id=$5 RETURNING *`,
        [title ?? task.title, description ?? task.description, status ?? task.status, assigneeId ?? task.assigneeId, taskId]);
      return c.json(updated.rows[0]);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
});

app.delete('/api/tasks/:taskId', auth, async (c) => {
  const { taskId } = c.req.param();
  const { id: userId } = getUser(c);
  const pool = getPool(c.env);
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`SELECT * FROM "Task" WHERE id=$1`, [taskId]);
      const task = rows[0];
      if (!task) return c.json({ error: 'Not found' }, 404);
      if (!(await canAccess(client, task.projectId, userId))) return c.json({ error: 'Forbidden' }, 403);
      await client.query(`DELETE FROM "Task" WHERE id=$1`, [taskId]);
      return c.json({ success: true });
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
});

// --- Analytics & Export ---
app.get('/api/projects/:id/analytics', auth, async (c) => {
  const { id } = c.req.param();
  const { id: userId } = getUser(c);
  const pool = getPool(c.env);
  try {
    const client = await pool.connect();
    try {
      if (!(await canAccess(client, id, userId))) return c.json({ error: 'Forbidden' }, 403);
      const { rows } = await client.query(
        `SELECT status, COUNT(*)::int AS count FROM "Task" WHERE "projectId"=$1 GROUP BY status`, [id]);
      return c.json(rows.map(r => ({ status: r.status, count: r.count })));
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
});

app.get('/api/projects/:id/export', auth, async (c) => {
  const { id } = c.req.param();
  const { id: userId } = getUser(c);
  const pool = getPool(c.env);
  try {
    const client = await pool.connect();
    try {
      if (!(await canAccess(client, id, userId))) return c.json({ error: 'Forbidden' }, 403);
      const project = (await client.query(`SELECT * FROM "Project" WHERE id=$1`, [id])).rows[0];
      const tasks = (await client.query(`SELECT * FROM "Task" WHERE "projectId"=$1`, [id])).rows;
      const memberships = (await client.query(
        `SELECT m.*, u.email FROM "Membership" m JOIN "User" u ON u.id=m."userId" WHERE m."projectId"=$1`, [id])).rows;
      c.header('Content-Disposition', `attachment; filename=project-${id}.json`);
      return c.json({ ...project, tasks, memberships });
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
});

// --- Public helpers ---
app.get('/api/all-projects', async (c) => {
  const pool = getPool(c.env);
  try {
    const { rows } = await pool.query(`SELECT * FROM "Project"`);
    return c.json(rows);
  } finally {
    await pool.end();
  }
});

app.post('/api/users/emails', async (c) => {
  const { ids } = await c.req.json();
  if (!Array.isArray(ids) || !ids.length) return c.json({});
  const pool = getPool(c.env);
  try {
    const { rows } = await pool.query(
      `SELECT id, email FROM "User" WHERE id = ANY($1::text[])`, [ids]);
    const result = {};
    rows.forEach(u => { result[u.id] = u.email; });
    return c.json(result);
  } finally {
    await pool.end();
  }
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal error' }, 500);
});

export default app;

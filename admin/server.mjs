import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.BLOG_REPO_ROOT || path.resolve(__dirname, '..');
const contentRoot = process.env.BLOG_CONTENT_ROOT || path.join(repoRoot, '.content-admin');
const blogDir = path.join(contentRoot, 'blog');
const projectsDir = path.join(contentRoot, 'projects');
const port = Number(process.env.BLOG_ADMIN_PORT || 4322);
const username = process.env.BLOG_ADMIN_USERNAME || 'admin';
const password = process.env.BLOG_ADMIN_PASSWORD || '';
const sessionSecret = process.env.BLOG_ADMIN_SESSION_SECRET || '';
const deployService = process.env.BLOG_DEPLOY_SERVICE || 'blog-deploy.service';
const sessionCookie = 'blog_admin_session';
const sessions = new Map();

if (!password || !sessionSecret) {
  console.error('缺少 BLOG_ADMIN_PASSWORD 或 BLOG_ADMIN_SESSION_SECRET');
  process.exit(1);
}

await ensureDirectory(blogDir);
await ensureDirectory(projectsDir);
await seedContentIfEmpty(path.join(repoRoot, 'src', 'content', 'blog'), blogDir);
await seedContentIfEmpty(path.join(repoRoot, 'src', 'content', 'projects'), projectsDir);

setInterval(cleanExpiredSessions, 15 * 60 * 1000).unref();

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return sendHtml(res, renderShell());
    }

    if (req.method === 'GET' && url.pathname === '/api/session') {
      const session = getSession(req);
      return sendJson(res, { authenticated: Boolean(session), username: session ? username : null });
    }

    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = await readJson(req);
      if (!isValidCredential(body?.username, body?.password)) {
        return sendJson(res, { error: '用户名或密码错误。' }, 401);
      }

      const token = createSession();
      res.setHeader(
        'Set-Cookie',
        `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 12}`,
      );
      return sendJson(res, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const token = parseCookies(req.headers.cookie || '')[sessionCookie];
      if (token) {
        sessions.delete(token);
      }
      res.setHeader('Set-Cookie', `${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      return sendJson(res, { ok: true });
    }

    if (!getSession(req)) {
      return sendJson(res, { error: '未登录。' }, 401);
    }

    if (req.method === 'GET' && url.pathname === '/api/posts') {
      return sendJson(res, { data: await listPosts() });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/posts/')) {
      const slug = decodeURIComponent(url.pathname.replace('/api/posts/', ''));
      const post = await readPost(slug);
      if (!post) {
        return sendJson(res, { error: '文章不存在。' }, 404);
      }
      return sendJson(res, { data: post });
    }

    if (req.method === 'POST' && url.pathname === '/api/posts') {
      const body = await readJson(req);
      const saved = await savePost(body);
      return sendJson(res, { data: saved });
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/posts/')) {
      const slug = decodeURIComponent(url.pathname.replace('/api/posts/', ''));
      await deletePost(slug);
      return sendJson(res, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/publish') {
      await execFileAsync('systemctl', ['start', deployService]);
      const status = await readDeployStatus();
      return sendJson(res, { ok: true, status });
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      return sendJson(res, { data: await readDeployStatus() });
    }

    sendJson(res, { error: '接口不存在。' }, 404);
  } catch (error) {
    console.error(error);
    sendJson(res, { error: '服务器内部错误。' }, 500);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`博客后台已启动：http://127.0.0.1:${port}`);
});

async function ensureDirectory(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function seedContentIfEmpty(sourceDir, targetDir) {
  const current = await fs.readdir(targetDir);
  if (current.length > 0) {
    return;
  }

  try {
    const sourceItems = await fs.readdir(sourceDir);
    await Promise.all(
      sourceItems
        .filter((name) => name.endsWith('.md') || name.endsWith('.mdx'))
        .map((name) => fs.copyFile(path.join(sourceDir, name), path.join(targetDir, name))),
    );
  } catch {
    // 忽略种子复制失败，目录仍可继续使用
  }
}

function cleanExpiredSessions() {
  const now = Date.now();
  for (const [token, expiresAt] of sessions.entries()) {
    if (expiresAt <= now) {
      sessions.delete(token);
    }
  }
}

function parseCookies(cookieHeader) {
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      const [key, ...rest] = entry.split('=');
      acc[key] = decodeURIComponent(rest.join('='));
      return acc;
    }, {});
}

function getSession(req) {
  const token = parseCookies(req.headers.cookie || '')[sessionCookie];
  if (!token) {
    return null;
  }
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return token;
}

function createSession() {
  const token = randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + 12 * 60 * 60 * 1000);
  return token;
}

function safeEqualString(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function isValidCredential(inputUser, inputPassword) {
  return safeEqualString(String(inputUser || ''), username) && safeEqualString(String(inputPassword || ''), password);
}

function sendHtml(res, html) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html);
}

function sendJson(res, payload, statusCode = 200) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw ? JSON.parse(raw) : {};
}

async function listPosts() {
  const files = await fs.readdir(blogDir);
  const posts = await Promise.all(
    files
      .filter((file) => file.endsWith('.md') || file.endsWith('.mdx'))
      .map(async (file) => {
        const slug = file.replace(/\.(md|mdx)$/i, '');
        const post = await readPost(slug);
        return post;
      }),
  );

  return posts
    .filter(Boolean)
    .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
}

async function readPost(slug) {
  const filePath = path.join(blogDir, `${slug}.md`);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = parseMarkdown(raw);
    return {
      slug,
      ...parsed.frontmatter,
      body: parsed.body,
    };
  } catch {
    return null;
  }
}

async function savePost(input) {
  const title = String(input?.title || '').trim();
  const description = String(input?.description || '').trim();
  const body = String(input?.body || '').trim();
  const rawSlug = String(input?.slug || '');
  const originalSlug = String(input?.originalSlug || rawSlug || '');
  const slug = createSlug(rawSlug || title);

  if (!title || !description || !body) {
    throw new Error('标题、摘要和正文不能为空。');
  }

  const frontmatter = {
    title,
    description,
    pubDate: normalizeDate(input?.pubDate) || today(),
    updatedDate: normalizeDate(input?.updatedDate) || today(),
    tags: normalizeTags(input?.tags),
    featured: Boolean(input?.featured),
    draft: Boolean(input?.draft),
  };

  if (originalSlug && originalSlug !== slug) {
    const oldPath = path.join(blogDir, `${originalSlug}.md`);
    await fs.rm(oldPath, { force: true });
  }

  const filePath = path.join(blogDir, `${slug}.md`);
  const fileContent = toMarkdown(frontmatter, body);
  await fs.writeFile(filePath, fileContent, 'utf-8');

  return { slug, ...frontmatter, body };
}

async function deletePost(slug) {
  await fs.rm(path.join(blogDir, `${slug}.md`), { force: true });
}

async function readDeployStatus() {
  try {
    const { stdout } = await execFileAsync('systemctl', ['status', deployService, '--no-pager']);
    return stdout;
  } catch (error) {
    return error.stdout || error.stderr || '暂时无法读取发布状态。';
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDate(value) {
  const date = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function createSlug(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || `post-${Date.now()}`;
}

function parseMarkdown(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }

  const frontmatter = parseFrontmatter(match[1]);
  return { frontmatter, body: match[2].trim() };
}

function parseFrontmatter(raw) {
  const lines = raw.split('\n');
  const result = {};
  let currentKey = '';

  for (const line of lines) {
    if (/^\s+-\s+/.test(line) && currentKey) {
      result[currentKey] ??= [];
      result[currentKey].push(line.replace(/^\s+-\s+/, '').trim());
      continue;
    }

    const match = line.match(/^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*)$/);
    if (!match) {
      continue;
    }

    currentKey = match[1];
    const value = match[2].trim();
    if (!value) {
      result[currentKey] = [];
      continue;
    }

    if (value === 'true' || value === 'false') {
      result[currentKey] = value === 'true';
      continue;
    }

    result[currentKey] = value.replace(/^['"]|['"]$/g, '');
  }

  return result;
}

function toMarkdown(frontmatter, body) {
  const lines = ['---'];
  lines.push(`title: ${frontmatter.title}`);
  lines.push(`description: ${frontmatter.description}`);
  lines.push(`pubDate: ${frontmatter.pubDate}`);
  lines.push(`updatedDate: ${frontmatter.updatedDate}`);
  lines.push('tags:');
  if (frontmatter.tags.length > 0) {
    for (const tag of frontmatter.tags) {
      lines.push(`  - ${tag}`);
    }
  } else {
    lines.push('  - 未分类');
  }
  lines.push(`featured: ${frontmatter.featured ? 'true' : 'false'}`);
  lines.push(`draft: ${frontmatter.draft ? 'true' : 'false'}`);
  lines.push('---');
  lines.push('');
  lines.push(body.trim());
  lines.push('');
  return lines.join('\n');
}

function renderShell() {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>博客后台</title>
    <style>
      :root {
        --bg: #f5f6f8;
        --panel: #ffffff;
        --line: #e5e7eb;
        --text: #1f2937;
        --muted: #6b7280;
        --accent: #2563eb;
        --accent-soft: rgba(37, 99, 235, 0.1);
        --danger: #b42318;
        --radius: 16px;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
        color: var(--text);
        background: linear-gradient(180deg, #f7f8fa 0%, #f2f4f7 100%);
      }
      button, input, textarea {
        font: inherit;
      }
      .hidden { display: none !important; }
      .login-shell, .app-shell {
        width: min(1240px, calc(100vw - 32px));
        margin: 28px auto;
      }
      .login-card, .app-panel, .editor-card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        box-shadow: 0 16px 48px rgba(15, 23, 42, 0.06);
      }
      .login-card {
        max-width: 420px;
        margin: 90px auto 0;
        padding: 28px;
      }
      .login-card h1 {
        margin: 0 0 12px;
        font-size: 1.8rem;
      }
      .login-card p {
        margin: 0 0 20px;
        color: var(--muted);
        line-height: 1.8;
      }
      .field {
        display: grid;
        gap: 8px;
        margin-bottom: 16px;
      }
      .field label {
        font-size: 0.92rem;
        color: var(--muted);
      }
      .field input,
      .field textarea {
        width: 100%;
        padding: 12px 14px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: #fff;
      }
      .field textarea {
        min-height: 360px;
        line-height: 1.8;
      }
      .btn-row {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }
      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 40px;
        padding: 0 16px;
        border-radius: 999px;
        border: 1px solid transparent;
        background: var(--accent);
        color: #fff;
        cursor: pointer;
        font-weight: 700;
      }
      .btn.secondary {
        background: #fff;
        color: var(--accent);
        border-color: #c7d2fe;
      }
      .btn.danger {
        background: #fff;
        color: var(--danger);
        border-color: #fecaca;
      }
      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        padding: 20px 24px;
        margin-bottom: 18px;
      }
      .topbar h1 {
        margin: 0;
        font-size: 1.45rem;
      }
      .topbar p {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 0.92rem;
      }
      .layout {
        display: grid;
        grid-template-columns: 300px minmax(0, 1fr);
        gap: 18px;
      }
      .sidebar, .editor-card {
        padding: 20px;
      }
      .sidebar h2 {
        margin: 0 0 14px;
        font-size: 1rem;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 18px;
      }
      .status-box {
        margin-top: 16px;
        padding: 12px 14px;
        border-radius: 12px;
        background: #f8fafc;
        border: 1px solid var(--line);
        color: var(--muted);
        font-size: 0.88rem;
        line-height: 1.7;
        white-space: pre-wrap;
      }
      .post-list {
        display: grid;
        gap: 10px;
      }
      .post-item {
        display: grid;
        gap: 6px;
        padding: 14px;
        border: 1px solid var(--line);
        border-radius: 14px;
        cursor: pointer;
        background: #fff;
      }
      .post-item.active {
        border-color: #93c5fd;
        background: var(--accent-soft);
      }
      .post-item strong {
        font-size: 0.96rem;
      }
      .post-item span {
        color: var(--muted);
        font-size: 0.84rem;
      }
      .editor-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
      }
      .editor-grid.full {
        grid-template-columns: 1fr;
      }
      .switch-row {
        display: flex;
        flex-wrap: wrap;
        gap: 18px;
        margin: 8px 0 18px;
        color: var(--muted);
      }
      .switch-row label {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .helper {
        margin-top: 18px;
        padding: 14px;
        border-radius: 12px;
        background: #f9fafb;
        border: 1px dashed #d1d5db;
        color: var(--muted);
        line-height: 1.8;
        font-size: 0.9rem;
      }
      .message {
        margin-top: 14px;
        color: var(--muted);
        font-size: 0.9rem;
      }
      @media (max-width: 960px) {
        .layout {
          grid-template-columns: 1fr;
        }
        .editor-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <section id="login-view" class="login-shell">
      <div class="login-card">
        <h1>博客后台</h1>
        <p>登录后可以在线编写文章、保存草稿，并一键触发博客发布。</p>
        <form id="login-form">
          <div class="field">
            <label for="login-username">用户名</label>
            <input id="login-username" name="username" value="${username}" autocomplete="username" />
          </div>
          <div class="field">
            <label for="login-password">密码</label>
            <input id="login-password" name="password" type="password" autocomplete="current-password" />
          </div>
          <div class="btn-row">
            <button class="btn" type="submit">登录后台</button>
          </div>
          <div id="login-message" class="message"></div>
        </form>
      </div>
    </section>

    <section id="app-view" class="app-shell hidden">
      <div class="app-panel topbar">
        <div>
          <h1>文章管理后台</h1>
          <p>这里管理的是博客文章内容源，保存后可直接发布到线上站点。</p>
        </div>
        <div class="btn-row">
          <button id="publish-button" class="btn">立即发布</button>
          <button id="logout-button" class="btn secondary">退出登录</button>
        </div>
      </div>

      <div class="layout">
        <aside class="app-panel sidebar">
          <div class="toolbar">
            <button id="new-post-button" class="btn secondary">新建文章</button>
          </div>
          <h2>文章列表</h2>
          <div id="post-list" class="post-list"></div>
          <div id="publish-status" class="status-box">当前还没有发布状态。</div>
        </aside>

        <section class="editor-card">
          <form id="editor-form">
            <div class="editor-grid">
              <div class="field">
                <label for="title">标题</label>
                <input id="title" name="title" required />
              </div>
              <div class="field">
                <label for="slug">链接别名</label>
                <input id="slug" name="slug" placeholder="留空则自动生成" />
              </div>
            </div>

            <div class="editor-grid">
              <div class="field">
                <label for="description">摘要</label>
                <input id="description" name="description" required />
              </div>
              <div class="field">
                <label for="tags">标签（用中文逗号分隔）</label>
                <input id="tags" name="tags" placeholder="人工智能，自动化，写作" />
              </div>
            </div>

            <div class="editor-grid">
              <div class="field">
                <label for="pubDate">发布时间</label>
                <input id="pubDate" name="pubDate" type="date" />
              </div>
              <div class="field">
                <label for="updatedDate">更新时间</label>
                <input id="updatedDate" name="updatedDate" type="date" />
              </div>
            </div>

            <div class="switch-row">
              <label><input id="featured" name="featured" type="checkbox" /> 设为精选文章</label>
              <label><input id="draft" name="draft" type="checkbox" /> 保存为草稿</label>
            </div>

            <div class="field">
              <label for="body">正文（Markdown 格式）</label>
              <textarea id="body" name="body" required></textarea>
            </div>

            <div class="btn-row">
              <button class="btn" type="submit">保存文章</button>
              <button id="delete-button" class="btn danger hidden" type="button">删除文章</button>
            </div>
            <div id="editor-message" class="message"></div>
          </form>

          <div class="helper">
            建议发布流程：先保存文章，再点击“立即发布”。<br />
            如果勾选“保存为草稿”，文章不会出现在前台。<br />
            正文支持 Markdown，和你现在仓库里的文章格式保持一致。
          </div>
        </section>
      </div>
    </section>

    <script>
      const state = {
        posts: [],
        currentSlug: '',
      };

      const loginView = document.getElementById('login-view');
      const appView = document.getElementById('app-view');
      const loginForm = document.getElementById('login-form');
      const loginMessage = document.getElementById('login-message');
      const editorForm = document.getElementById('editor-form');
      const editorMessage = document.getElementById('editor-message');
      const postList = document.getElementById('post-list');
      const publishStatus = document.getElementById('publish-status');
      const newPostButton = document.getElementById('new-post-button');
      const publishButton = document.getElementById('publish-button');
      const logoutButton = document.getElementById('logout-button');
      const deleteButton = document.getElementById('delete-button');

      const fields = {
        title: document.getElementById('title'),
        slug: document.getElementById('slug'),
        description: document.getElementById('description'),
        tags: document.getElementById('tags'),
        pubDate: document.getElementById('pubDate'),
        updatedDate: document.getElementById('updatedDate'),
        featured: document.getElementById('featured'),
        draft: document.getElementById('draft'),
        body: document.getElementById('body'),
      };

      async function request(url, options = {}) {
        const response = await fetch(url, {
          headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
          ...options,
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || '请求失败');
        }
        return payload;
      }

      function setView(authenticated) {
        loginView.classList.toggle('hidden', authenticated);
        appView.classList.toggle('hidden', !authenticated);
      }

      function resetEditor() {
        state.currentSlug = '';
        editorForm.reset();
        fields.pubDate.value = new Date().toISOString().slice(0, 10);
        fields.updatedDate.value = new Date().toISOString().slice(0, 10);
        fields.body.value = '';
        deleteButton.classList.add('hidden');
        editorMessage.textContent = '已切换到新建文章模式。';
        renderPosts();
      }

      function fillEditor(post) {
        state.currentSlug = post.slug;
        fields.title.value = post.title || '';
        fields.slug.value = post.slug || '';
        fields.description.value = post.description || '';
        fields.tags.value = (post.tags || []).join('，');
        fields.pubDate.value = post.pubDate || '';
        fields.updatedDate.value = post.updatedDate || '';
        fields.featured.checked = Boolean(post.featured);
        fields.draft.checked = Boolean(post.draft);
        fields.body.value = post.body || '';
        deleteButton.classList.remove('hidden');
        editorMessage.textContent = '已载入文章，可继续编辑。';
        renderPosts();
      }

      function renderPosts() {
        postList.innerHTML = '';
        if (state.posts.length === 0) {
          postList.innerHTML = '<div class="post-item"><strong>还没有文章</strong><span>先点击“新建文章”开始写第一篇。</span></div>';
          return;
        }

        state.posts.forEach((post) => {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'post-item' + (state.currentSlug === post.slug ? ' active' : '');
          item.innerHTML = '<strong>' + post.title + '</strong>' +
            '<span>' + (post.pubDate || '') + ' · ' + (post.draft ? '草稿' : '已发布') + '</span>';
          item.addEventListener('click', async () => {
            const payload = await request('/api/posts/' + encodeURIComponent(post.slug));
            fillEditor(payload.data);
          });
          postList.appendChild(item);
        });
      }

      async function loadPosts() {
        const payload = await request('/api/posts');
        state.posts = payload.data || [];
        renderPosts();
      }

      async function loadStatus() {
        const payload = await request('/api/status');
        publishStatus.textContent = payload.data;
      }

      loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        loginMessage.textContent = '正在登录...';
        try {
          await request('/api/login', {
            method: 'POST',
            body: JSON.stringify({
              username: document.getElementById('login-username').value.trim(),
              password: document.getElementById('login-password').value,
            }),
          });
          setView(true);
          await Promise.all([loadPosts(), loadStatus()]);
          resetEditor();
        } catch (error) {
          loginMessage.textContent = error.message;
        }
      });

      editorForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        editorMessage.textContent = '正在保存...';
        try {
          const payload = await request('/api/posts', {
            method: 'POST',
            body: JSON.stringify({
              originalSlug: state.currentSlug,
              slug: fields.slug.value.trim(),
              title: fields.title.value.trim(),
              description: fields.description.value.trim(),
              tags: fields.tags.value.trim(),
              pubDate: fields.pubDate.value,
              updatedDate: fields.updatedDate.value,
              featured: fields.featured.checked,
              draft: fields.draft.checked,
              body: fields.body.value,
            }),
          });
          state.currentSlug = payload.data.slug;
          fields.slug.value = payload.data.slug;
          deleteButton.classList.remove('hidden');
          editorMessage.textContent = '保存成功。';
          await loadPosts();
        } catch (error) {
          editorMessage.textContent = error.message;
        }
      });

      deleteButton.addEventListener('click', async () => {
        if (!state.currentSlug) return;
        if (!confirm('确定要删除这篇文章吗？')) return;
        editorMessage.textContent = '正在删除...';
        try {
          await request('/api/posts/' + encodeURIComponent(state.currentSlug), { method: 'DELETE' });
          await loadPosts();
          resetEditor();
          editorMessage.textContent = '文章已删除。';
        } catch (error) {
          editorMessage.textContent = error.message;
        }
      });

      newPostButton.addEventListener('click', () => {
        resetEditor();
      });

      publishButton.addEventListener('click', async () => {
        publishButton.disabled = true;
        publishStatus.textContent = '正在触发发布，请稍候...';
        try {
          const payload = await request('/api/publish', { method: 'POST' });
          publishStatus.textContent = payload.status || '已触发发布。';
        } catch (error) {
          publishStatus.textContent = error.message;
        } finally {
          publishButton.disabled = false;
        }
      });

      logoutButton.addEventListener('click', async () => {
        await request('/api/logout', { method: 'POST' });
        location.reload();
      });

      (async () => {
        try {
          const payload = await request('/api/session');
          if (payload.authenticated) {
            setView(true);
            await Promise.all([loadPosts(), loadStatus()]);
            resetEditor();
          } else {
            setView(false);
          }
        } catch {
          setView(false);
        }
      })();
    </script>
  </body>
</html>`;
}

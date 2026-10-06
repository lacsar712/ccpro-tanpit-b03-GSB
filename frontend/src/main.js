import { LitElement, css, html } from "lit";

const TOKEN_KEY = "tanpit_token";
const LABELS = { fill: "注液", tanning: "鞣制中", drained: "已放液" };
const CHECKS = [
  { key: "coverClosed", label: "渠盖已盖" },
  { key: "scraperStowed", label: "刮板已收" },
  { key: "railReset", label: "护栏已复位" },
];

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "请求失败");
  return data;
}

function checksComplete(pit) {
  return CHECKS.every((c) => pit[c.key]);
}

class TanYard extends LitElement {
  static properties = {
    ready: { type: Boolean },
    board: { type: Object },
    picked: { type: Object },
    ph: { type: String },
    err: { type: String },
    username: { type: String },
    password: { type: String },
    me: { type: Object },
    tab: { type: String },
    drafts: { type: Object },
    notices: { type: Object },
  };

  static styles = css`
    :host { display: block; font-family: "KaiTi", serif; color: #2b2118; }
    .wrap { max-width: 880px; margin: 0 auto; padding: 28px 16px 50px; }
    .topbar { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #b7a48c; padding-bottom: 10px; margin-bottom: 16px; }
    .topbar h1 { font-size: 1.3em; margin: 0; flex: 1; }
    .topbar button, nav button { font: inherit; padding: 6px 14px; }
    nav button.active { background: #5a4632; color: #fff; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .pit { min-height: 110px; border-radius: 8px; color: #fff; cursor: pointer; border: 0; }
    .pit.sel { outline: 3px solid #c2872a; }
    .fill { background: #6d8f9e; }
    .tanning { background: #8a5a2b; }
    .drained { background: #5f6f4a; }
    .err { color: #9b1c1c; }
    .ok { color: #2f6b2f; }
    .hint { color: #6b5a48; font-size: 0.92em; }
    label { display: block; margin: 8px 0; }
    input, button { font: inherit; padding: 8px 10px; margin: 4px 6px 4px 0; }
    section.drawer, .check-card { border: 1px solid #cbbbA2; border-radius: 8px; padding: 12px 16px; margin-top: 18px; background: #faf6ee; }
    .check-card { margin-top: 12px; }
    .check-card .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .check-card .code { font-size: 1.15em; min-width: 64px; }
    .tag { font-size: 0.8em; padding: 1px 8px; border-radius: 10px; color: #fff; background: #8a7a63; }
    .tag.fill { background: #6d8f9e; }
    .tag.tanning { background: #8a5a2b; }
    .tag.drained { background: #5f6f4a; }
    .badge-yes { color: #2f6b2f; }
    .badge-no { color: #9b1c1c; }
  `;

  constructor() {
    super();
    this.ready = false;
    this.board = null;
    this.picked = null;
    this.ph = "4.2";
    this.err = "";
    this.username = "admin";
    this.password = "123456";
    this.me = null;
    this.tab = "board";
    this.drafts = {};
    this.notices = {};
  }

  connectedCallback() {
    super.connectedCallback();
    if (localStorage.getItem(TOKEN_KEY)) this.boot();
  }

  async boot() {
    try {
      this.me = await api("/api/auth/me");
      this.ready = true;
      await this.refresh();
    } catch (e) {
      localStorage.removeItem(TOKEN_KEY);
      this.ready = false;
      this.me = null;
      this.err = "";
    }
  }

  async refresh() {
    try {
      this.board = await api("/api/board");
      // 以服务端为准重建三勾草稿。
      const drafts = {};
      for (const p of this.board.pits) {
        drafts[p.id] = Object.fromEntries(CHECKS.map((c) => [c.key, p[c.key]]));
      }
      this.drafts = drafts;
      if (this.picked) {
        this.picked = this.board.pits.find((p) => p.id === this.picked.id) || null;
      }
    } catch (e) {
      this.err = e.message;
    }
  }

  async login(e) {
    e.preventDefault();
    this.err = "";
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: this.username, password: this.password }),
      });
      localStorage.setItem(TOKEN_KEY, data.access_token);
      this.me = data.user;
      this.ready = true;
      this.tab = "board";
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    this.ready = false;
    this.me = null;
    this.board = null;
    this.picked = null;
  }

  async writePh() {
    this.err = "";
    try {
      this.picked = await api(`/api/pits/${this.picked.id}/samples`, {
        method: "POST",
        body: JSON.stringify({ ph: Number(this.ph) }),
      });
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  async setStatus(status) {
    this.err = "";
    try {
      this.picked = await api(`/api/pits/${this.picked.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await this.refresh();
    } catch (ex) {
      // 三勾未齐 / pH 不合格 / 并发抢标，后端拒绝原文照示。
      this.err = ex.message;
      await this.refresh();
    }
  }

  isAdmin() {
    return this.me?.role === "admin";
  }

  toggleDraft(pitId, key, checked) {
    this.drafts = { ...this.drafts, [pitId]: { ...this.drafts[pitId], [key]: checked } };
  }

  async saveChecks(pit) {
    this.err = "";
    try {
      await api(`/api/pits/${pit.id}/checks`, {
        method: "POST",
        body: JSON.stringify(this.drafts[pit.id]),
      });
      this.notices = { ...this.notices, [pit.id]: "已保存" };
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  renderCheckBadges(pit) {
    return CHECKS.map(
      (c) =>
        html`<span class=${pit[c.key] ? "badge-yes" : "badge-no"}
          >${c.label}${pit[c.key] ? " ✓" : " ✗"}</span
        >`
    );
  }

  renderLogin() {
    return html`<div class="wrap">
      <h1>南冈鞣场</h1>
      <form @submit=${this.login} autocomplete="off">
        <label>用户名
          <input name="username" autocomplete="off" .value=${this.username} @input=${(e) => (this.username = e.target.value)} />
        </label>
        <label>密码
          <input name="password" type="password" autocomplete="off" .value=${this.password} @input=${(e) => (this.password = e.target.value)} />
        </label>
        <p class="hint">已预填 admin / 123456，另有 worker / 123456</p>
        <button>登录</button>
      </form>
      ${this.err ? html`<p class="err">${this.err}</p>` : ""}
    </div>`;
  }

  renderBoard() {
    return html`
      <p>${this.board.village} · 点坑登记浸液酸碱度；放液须最近读数 3.5～5.0 且三勾齐</p>
      <div class="grid">
        ${this.board.pits.map(
          (p) => html`<button class="pit ${p.status} ${this.picked?.id === p.id ? "sel" : ""}" @click=${() => (this.picked = p)}>
            <strong>${p.code}</strong><br />${LABELS[p.status]}
          </button>`
        )}
      </div>
      ${this.picked ? this.renderDrawer(this.picked) : ""}
    `;
  }

  renderDrawer(p) {
    const complete = checksComplete(p);
    return html`<section class="drawer">
      <h3>${p.code} · ${LABELS[p.status]}</h3>
      <p>最近酸碱度：${p.latestPh ?? "无"} · ${p.sampleCount} 次</p>
      <p class="${complete ? "ok" : "err"}">
        放液三勾：${this.renderCheckBadges(p)} — ${complete ? "已齐" : "未齐，未齐不可放液"}
        ${!complete
          ? this.isAdmin()
            ? html` <button type="button" @click=${() => (this.tab = "checks")}>去三勾页勾齐</button>`
            : html` <span>请联系管理员勾齐</span>`
          : ""}
      </p>
      <input .value=${this.ph} @input=${(e) => (this.ph = e.target.value)} />
      <button @click=${this.writePh}>登记酸碱度</button>
      <div>
        <button @click=${() => this.setStatus("fill")}>注液</button>
        <button @click=${() => this.setStatus("tanning")}>鞣制中</button>
        <button @click=${() => this.setStatus("drained")} ?disabled=${p.status === "drained"}>已放液</button>
      </div>
    </section>`;
  }

  renderChecks() {
    const admin = this.isAdmin();
    return html`
      <p class="hint">
        放液前每坑须勾齐：渠盖已盖、刮板已收、护栏已复位。
        ${admin ? "管理员可勾可改，逐坑保存。" : "操作工只读，如需勾改请联系管理员。"}
      </p>
      ${this.board.pits.map((p) => {
        const serverComplete = checksComplete(p);
        const draft = this.drafts[p.id] || {};
        const dirty = CHECKS.some((c) => Boolean(draft[c.key]) !== Boolean(p[c.key]));
        return html`<div class="check-card">
          <div class="row">
            <span class="code"><strong>${p.code}</strong></span>
            <span class="tag ${p.status}">${LABELS[p.status]}</span>
            <span class="${serverComplete ? "ok" : "err"}">${serverComplete ? "三勾已齐" : "三勾未齐"}</span>
          </div>
          <div class="row">
            ${CHECKS.map((c) => html`
              <label>
                <input
                  type="checkbox"
                  ?checked=${draft[c.key] ?? false}
                  ?disabled=${!admin}
                  @change=${(e) => this.toggleDraft(p.id, c.key, e.target.checked)}
                />${c.label}
              </label>`)}
            ${admin
              ? html`<button @click=${() => this.saveChecks(p)} ?disabled=${!dirty}>保存</button>
                  <span class="ok">${dirty ? "" : (this.notices[p.id] || "")}</span>`
              : html`<span class="hint">（只读）</span>`}
          </div>
        </div>`;
      })}
    `;
  }

  render() {
    if (!this.ready) return this.renderLogin();
    if (!this.board) return html`<div class="wrap">${this.err || "装载坑位…"}</div>`;
    return html`<div class="wrap">
      <div class="topbar">
        <h1>${this.board.yard}</h1>
        <nav>
          <button class=${this.tab === "board" ? "active" : ""} @click=${() => (this.tab = "board")}>坑位场地图</button>
          <button class=${this.tab === "checks" ? "active" : ""} @click=${() => (this.tab = "checks")}>放液三勾</button>
        </nav>
        <span class="hint">${this.me.username} · ${this.me.role === "admin" ? "管理员" : "操作工"}</span>
        <button @click=${this.logout}>退出</button>
      </div>
      ${this.tab === "board" ? this.renderBoard() : this.renderChecks()}
      ${this.err ? html`<p class="err">${this.err}</p>` : ""}
    </div>`;
  }
}

customElements.define("tan-yard", TanYard);

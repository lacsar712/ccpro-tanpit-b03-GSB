import { LitElement, css, html } from "lit";

const TOKEN_KEY = "tanpit_token";
const ROLE_KEY = "tanpit_role";
const NAME_KEY = "tanpit_name";
const LABELS = { fill: "注液", tanning: "鞣制中", drained: "已放液" };
const CHECK_ITEMS = [
  { key: "coverClosed", label: "渠盖已盖" },
  { key: "scraperStowed", label: "刮板已收" },
  { key: "guardRestored", label: "护栏已复位" },
];

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.detail || "请求失败"), { status: res.status });
  return data;
}

function allChecked(checks) {
  return CHECK_ITEMS.every((c) => checks[c.key]);
}

class TanYard extends LitElement {
  static properties = {
    ready: { type: Boolean },
    view: { type: String },
    board: { type: Object },
    picked: { type: Object },
    ph: { type: String },
    err: { type: String },
    username: { type: String },
    password: { type: String },
    role: { type: String },
    name: { type: String },
    drafts: { type: Object },
    saveErr: { type: Object },
  };

  static styles = css`
    :host { display: block; font-family: "KaiTi", serif; color: #2b2118; }
    .wrap { max-width: 880px; margin: 0 auto; padding: 28px 16px 50px; }
    .topbar { display: flex; align-items: center; gap: 10px; border-bottom: 2px solid #8a5a2b; padding-bottom: 10px; margin-bottom: 16px; }
    .topbar h1 { font-size: 1.25em; margin: 0 18px 0 0; }
    .navbtn { background: #f3ece2; border: 1px solid #8a5a2b; color: #2b2118; padding: 6px 14px; cursor: pointer; border-radius: 4px; }
    .navbtn.active { background: #8a5a2b; color: #fff; }
    .who { margin-left: auto; color: #6b5a48; font-size: 0.92em; }
    .who button { margin-left: 8px; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .pit { min-height: 110px; border-radius: 8px; color: #fff; cursor: pointer; border: 0; position: relative; }
    .fill { background: #6d8f9e; }
    .tanning { background: #8a5a2b; }
    .drained { background: #5f6f4a; }
    .badge { position: absolute; top: 6px; right: 8px; font-size: 0.72em; background: rgba(0,0,0,0.35); border-radius: 4px; padding: 1px 6px; }
    .err { color: #9b1c1c; }
    .ok { color: #3d5a1f; }
    .hint { color: #6b5a48; font-size: 0.92em; }
    label { display: block; margin: 8px 0; }
    input, button { font: inherit; padding: 8px 10px; margin: 4px 6px 4px 0; }
    .check-row { border: 1px solid #c9b89f; border-radius: 8px; padding: 12px 14px; margin: 10px 0; background: #faf6ef; }
    .check-row.missing { border-color: #9b1c1c; background: #fbeeee; }
    .check-item { display: inline-flex; align-items: center; gap: 4px; margin-right: 18px; }
    .check-item input { margin: 0; }
    .chips span { display: inline-block; margin-right: 14px; font-size: 0.95em; }
    .tag-no { color: #9b1c1c; font-weight: bold; }
    .tag-yes { color: #3d5a1f; }
    .meta { color: #6b5a48; font-size: 0.85em; }
  `;

  constructor() {
    super();
    this.ready = Boolean(localStorage.getItem(TOKEN_KEY));
    this.view = "board";
    this.board = null;
    this.picked = null;
    this.ph = "4.2";
    this.err = "";
    this.username = "admin";
    this.password = "123456";
    this.role = localStorage.getItem(ROLE_KEY) || "";
    this.name = localStorage.getItem(NAME_KEY) || "";
    this.drafts = {};
    this.saveErr = {};
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.ready) this.refresh();
  }

  async refresh() {
    try {
      this.board = await api("/api/board");
      if (this.picked) {
        this.picked = this.board.pits.find((p) => p.id === this.picked.id) || null;
      }
    } catch (e) {
      if (e.status === 401) this.logout(false);
      else this.err = e.message;
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
      localStorage.setItem(ROLE_KEY, data.user.role);
      localStorage.setItem(NAME_KEY, data.user.username);
      this.role = data.user.role;
      this.name = data.user.username;
      this.ready = true;
      await this.refresh();
    } catch (ex) {
      this.err = ex.message;
    }
  }

  logout(reload = true) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(NAME_KEY);
    this.ready = false;
    this.role = "";
    this.name = "";
    this.board = null;
    this.picked = null;
    if (reload) this.err = "";
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
      // 三勾未齐 / 酸碱度不合规时后端拒绝，原样回显，状态不变
      this.err = ex.message;
      this.requestUpdate();
    }
  }

  draftFor(pit) {
    // 未手动勾改前直接用后端已存值；只有勾过才有草稿，脏标记才成立
    return (
      this.drafts[pit.id] || {
        coverClosed: pit.checks.coverClosed,
        scraperStowed: pit.checks.scraperStowed,
        guardRestored: pit.checks.guardRestored,
      }
    );
  }

  toggleDraft(pit, key, checked) {
    const d = this.draftFor(pit);
    d[key] = checked;
    this.drafts = { ...this.drafts, [pit.id]: { ...d } };
  }

  async saveChecks(pit) {
    this.saveErr = { ...this.saveErr, [pit.id]: "" };
    const d = this.drafts[pit.id];
    try {
      await api(`/api/pits/${pit.id}/checklist`, {
        method: "PUT",
        body: JSON.stringify(d),
      });
      delete this.drafts[pit.id];
      this.drafts = { ...this.drafts };
      await this.refresh();
    } catch (ex) {
      this.saveErr = { ...this.saveErr, [pit.id]: ex.message };
    }
  }

  renderTopbar() {
    return html`<div class="topbar">
      <h1>南冈鞣场</h1>
      <button class="navbtn ${this.view === "board" ? "active" : ""}" @click=${() => (this.view = "board")}>坑位场地图</button>
      <button class="navbtn ${this.view === "checks" ? "active" : ""}" @click=${() => (this.view = "checks")}>放液三勾</button>
      <span class="who">${this.name} · ${this.role === "admin" ? "管理员" : "操作工"}
        <button @click=${() => this.logout()}>退出</button>
      </span>
    </div>`;
  }

  renderBoard() {
    const isAdmin = this.role === "admin";
    return html`
      <p class="hint">${this.board.village} · 点坑登记浸液酸碱度；放液须最近读数 3.5～5.0 且三勾齐</p>
      <div class="grid">
        ${this.board.pits.map(
          (p) => html`<button class="pit ${p.status}" @click=${() => (this.picked = p)}>
            <strong>${p.code}</strong><br />${LABELS[p.status]}
            <span class="badge">${p.status === "drained" || allChecked(p.checks) ? "三勾齐" : "三勾缺"}</span>
          </button>`
        )}
      </div>
      ${this.picked
        ? html`<section>
            <h3>${this.picked.code} · ${LABELS[this.picked.status]}</h3>
            <p>最近酸碱度：${this.picked.latestPh ?? "无"} · ${this.picked.sampleCount} 次</p>
            <div class="chips">
              ${CHECK_ITEMS.map((c) => {
                const on = this.picked.checks[c.key];
                return html`<span class="${on ? "tag-yes" : "tag-no"}">${on ? "✓" : "✗"} ${c.label}</span>`;
              })}
            </div>
            <input .value=${this.ph} @input=${(e) => (this.ph = e.target.value)} />
            <button @click=${this.writePh}>登记酸碱度</button>
            <div>
              <button @click=${() => this.setStatus("fill")}>注液</button>
              <button @click=${() => this.setStatus("tanning")}>鞣制中</button>
              <button @click=${() => this.setStatus("drained")}>已放液</button>
              ${!isAdmin
                ? html`<span class="hint">三勾需管理员在「放液三勾」页勾齐</span>`
                : html`<button @click=${() => (this.view = "checks")}>去勾三勾</button>`}
            </div>
          </section>`
        : ""}
      ${this.err ? html`<p class="err">${this.err}</p>` : ""}
    `;
  }

  renderChecks() {
    const isAdmin = this.role === "admin";
    return html`
      <p class="hint">放液三勾：渠盖已盖、刮板已收、护栏已复位。未勾齐的坑不能放液。
        ${isAdmin ? "管理员可勾可改，改完点保存。" : "操作工只能查看，勾改请找管理员。"}</p>
      ${this.board.pits.map((p) => {
        const saved = p.checks;
        const savedAll = allChecked(saved);
        const d = this.draftFor(p);
        const draftAll = CHECK_ITEMS.every((c) => d[c.key]);
        const dirty = this.drafts[p.id] !== undefined;
        return html`<div class="check-row ${draftAll ? "" : "missing"}">
          <strong>${p.code}</strong>
          <span class="hint">（${LABELS[p.status]}）</span>
          ${CHECK_ITEMS.map(
            (c) => html`<label class="check-item">
              <input type="checkbox" ?checked=${d[c.key]} ?disabled=${!isAdmin}
                @change=${(e) => this.toggleDraft(p, c.key, e.target.checked)} />
              ${c.label}
            </label>`
          )}
          <span class="${draftAll ? "tag-yes" : "tag-no"}">${draftAll ? "三勾已齐" : "三勾未齐"}</span>
          <div>
            ${isAdmin
              ? html`<button ?disabled=${!dirty} @click=${() => this.saveChecks(p)}>保存</button>`
              : ""}
            ${dirty && !savedAll ? html`<span class="hint">勾齐保存后才可放液</span>` : ""}
          </div>
          <div class="meta">
            ${saved.updatedBy ? `上次登记：${saved.updatedBy} · ${saved.updatedAt ? new Date(saved.updatedAt).toLocaleString("zh-CN") : ""}` : "尚无勾记录，按未勾处理"}
          </div>
          ${this.saveErr[p.id] ? html`<p class="err">${this.saveErr[p.id]}</p>` : ""}
          ${savedAll ? html`<p class="ok">已齐，可放液。</p>` : ""}
        </div>`;
      })}
      ${this.err ? html`<p class="err">${this.err}</p>` : ""}
    `;
  }

  render() {
    if (!this.ready) {
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
    if (!this.board) return html`<div class="wrap">${this.err || "装载坑位…"}</div>`;
    return html`<div class="wrap">
      ${this.renderTopbar()}
      ${this.view === "board" ? this.renderBoard() : this.renderChecks()}
    </div>`;
  }
}

customElements.define("tan-yard", TanYard);

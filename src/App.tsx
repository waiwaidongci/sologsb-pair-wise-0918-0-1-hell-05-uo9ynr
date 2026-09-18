import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import {
  Banks,
  O2_CLEAN_LIMIT,
  Order,
  OrderStatus,
  TOL_HE,
  TOL_O2,
  bankIssue,
  planBlend,
  startBlockers,
} from "./blending";

const LS_KEY = "hxyfront-62010-mixdesk-v1";
const DEFAULT_BANKS: Banks = { helium: 160, oxygen: 140, air: 230 };

interface Persisted {
  orders: Order[];
  banks: Banks;
}

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Persisted;
      if (parsed && Array.isArray(parsed.orders) && parsed.banks) return parsed;
    }
  } catch {
    /* 本地数据损坏时回退到初始状态 */
  }
  return { orders: [], banks: DEFAULT_BANKS };
}

function todayStr(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const f1 = (n: number) => n.toFixed(1);
const fmtTime = (ts: number) => new Date(ts).toLocaleString("zh-CN", { hour12: false });

const STATUS_TEXT: Record<OrderStatus, string> = {
  pending: "待确认",
  filling: "充填中 · 已锁定",
  review: "待签收复核",
  archived: "已归档",
};

interface FormState {
  tankId: string;
  volume: string;
  rated: string;
  inspectionDate: string;
  residual: string;
  target: string;
  o2: string;
  he: string;
  o2CleanValve: boolean;
  operator: string;
}

const EMPTY_FORM: FormState = {
  tankId: "",
  volume: "12",
  rated: "207",
  inspectionDate: "",
  residual: "",
  target: "200",
  o2: "",
  he: "0",
  o2CleanValve: false,
  operator: "",
};

interface Flash {
  kind: "ok" | "error";
  lines: string[];
}

function App() {
  const [persisted, setPersisted] = useState<Persisted>(loadPersisted);
  const { orders, banks } = persisted;
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [tankHint, setTankHint] = useState("");
  const [archiveFilter, setArchiveFilter] = useState("");
  const today = todayStr();

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(persisted));
  }, [persisted]);

  const setOrders = (fn: (os: Order[]) => Order[]) =>
    setPersisted((p) => ({ ...p, orders: fn(p.orders) }));
  const setBank = (key: keyof Banks, value: number) =>
    setPersisted((p) => ({ ...p, banks: { ...p.banks, [key]: value } }));

  const counts = useMemo(
    () => ({
      pending: orders.filter((o) => o.status === "pending").length,
      filling: orders.filter((o) => o.status === "filling").length,
      review: orders.filter((o) => o.status === "review").length,
      archived: orders.filter((o) => o.status === "archived").length,
    }),
    [orders]
  );

  const activeOrders = useMemo(() => {
    const rank: Record<OrderStatus, number> = { review: 0, filling: 1, pending: 2, archived: 3 };
    return orders
      .filter((o) => o.status !== "archived")
      .sort((a, b) => rank[a.status] - rank[b.status] || b.updatedAt - a.updatedAt);
  }, [orders]);

  const archivedOrders = useMemo(
    () =>
      orders
        .filter((o) => o.status === "archived")
        .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)),
    [orders]
  );

  const filteredArchive = archivedOrders.filter(
    (o) => !archiveFilter.trim() || o.tankId.includes(archiveFilter.trim().toUpperCase())
  );

  const handleTankChange = (value: string) => {
    const tankId = value.trim().toUpperCase();
    const hit = orders.find((o) => o.tankId === tankId && o.status === "pending");
    if (hit) {
      setForm({
        tankId: hit.tankId,
        volume: String(hit.volume),
        rated: String(hit.rated),
        inspectionDate: hit.inspectionDate,
        residual: String(hit.residual),
        target: String(hit.target),
        o2: String(hit.o2),
        he: String(hit.he),
        o2CleanValve: hit.o2CleanValve,
        operator: hit.operator,
      });
      setTankHint(`已载入 ${hit.tankId} 的待确认单 ${hit.id}，提交将更新该单，不会新增单据`);
    } else {
      setForm((f) => ({ ...f, tankId: value }));
      setTankHint("");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const tankId = form.tankId.trim().toUpperCase();
    const volume = Number(form.volume);
    const rated = Number(form.rated);
    const residual = Number(form.residual);
    const target = Number(form.target);
    const o2 = Number(form.o2);
    const he = Number(form.he);
    const operator = form.operator.trim();

    const errs: string[] = [];
    if (!tankId) errs.push("请填写气瓶编号");
    if (!(volume > 0)) errs.push("容积须大于 0");
    if (!(rated > 0)) errs.push("请填写有效的耐压值");
    if (!form.inspectionDate) errs.push("请选择检验日期");
    if (form.residual.trim() === "" || !(residual >= 0)) errs.push("残压须不小于 0");
    if (!(target > 0)) errs.push("请填写有效的目标压力");
    if (rated > 0 && target > rated) errs.push(`目标压力 ${target}bar 超过耐压值 ${rated}bar`);
    if (target > 0 && residual >= target) errs.push("残压须低于目标压力");
    if (form.o2.trim() === "" || !(o2 >= 10 && o2 <= 100)) errs.push("目标氧含量须在 10–100% 之间");
    if (form.he.trim() === "" || !(he >= 0 && he <= 85)) errs.push("目标氦含量须在 0–85% 之间");
    if (o2 + he > 100) errs.push("氧氦目标之和不能超过 100%");
    if (!operator) errs.push("请填写操作员");
    if (errs.length) {
      setFlash({ kind: "error", lines: errs });
      return;
    }

    const locked = orders.find(
      (o) => o.tankId === tankId && (o.status === "filling" || o.status === "review")
    );
    if (locked) {
      setFlash({
        kind: "error",
        lines: [
          `气瓶 ${tankId} 的配气单 ${locked.id} 已启动并锁定（${STATUS_TEXT[locked.status]}），不能再提交或修改`,
        ],
      });
      return;
    }

    const plan = planBlend(residual, target, o2, he);
    if ("error" in plan) {
      setFlash({ kind: "error", lines: [plan.error] });
      return;
    }

    const existing = orders.find((o) => o.tankId === tankId && o.status === "pending");
    if (existing) {
      setOrders((os) =>
        os.map((o) =>
          o.id === existing.id
            ? {
                ...o,
                volume,
                rated,
                inspectionDate: form.inspectionDate,
                residual,
                target,
                o2,
                he,
                o2CleanValve: form.o2CleanValve,
                operator,
                steps: plan.steps,
                updatedAt: Date.now(),
              }
            : o
        )
      );
      setFlash({
        kind: "ok",
        lines: [`气瓶 ${tankId} 已有待确认单 ${existing.id}，已按新参数更新，未产生第二张单`],
      });
    } else {
      const order: Order = {
        id: `MX-${String(orders.length + 1).padStart(3, "0")}`,
        tankId,
        volume,
        rated,
        inspectionDate: form.inspectionDate,
        residual,
        target,
        o2,
        he,
        o2CleanValve: form.o2CleanValve,
        operator,
        status: "pending",
        steps: plan.steps,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setOrders((os) => [order, ...os]);
      setFlash({
        kind: "ok",
        lines: [`已生成配气单 ${order.id}，充填步骤按分压顺序：氦 → 氧 → 空气顶充`],
      });
    }
    setTankHint("");
  };

  const handleStart = (id: string) =>
    setOrders((os) =>
      os.map((o) =>
        o.id === id ? { ...o, status: "filling", startedAt: Date.now(), updatedAt: Date.now() } : o
      )
    );

  const handleComplete = (id: string) =>
    setOrders((os) =>
      os.map((o) => (o.id === id ? { ...o, status: "review", updatedAt: Date.now() } : o))
    );

  const handleSign = (id: string, measuredO2: number, measuredHe: number) => {
    setOrders((os) =>
      os.map((o) =>
        o.id === id
          ? {
              ...o,
              status: "archived",
              measuredO2,
              measuredHe,
              archivedAt: Date.now(),
              updatedAt: Date.now(),
            }
          : o
      )
    );
    setFlash({ kind: "ok", lines: [`配气单 ${id} 复核通过，已写入混气档案`] });
  };

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62010 · 源提示词5 · Port 62010</p>
        <h1>气瓶混气复核台</h1>
        <span>
          登记耐压值、检验日期、残压、目标压力与氧氦目标后，系统按分压顺序（氦 → 氧 →
          空气顶充）算出充填步骤。氧含量超过 {O2_CLEAN_LIMIT}% 未选专用阀门不得开工；
          储气组压力不足时保留原目标并写明原因。启动后锁定气瓶与配气单，签收前须复核实测氧氦值，
          偏差超限不能签收；通过后写入混气档案，重载页面仍可追溯。
        </span>
      </section>

      <section className="metrics">
        <article>
          <small>待确认配气单</small>
          <strong>{counts.pending}</strong>
        </article>
        <article>
          <small>充填中（已锁定）</small>
          <strong>{counts.filling}</strong>
        </article>
        <article>
          <small>待签收复核</small>
          <strong>{counts.review}</strong>
        </article>
        <article>
          <small>混气档案</small>
          <strong>{counts.archived}</strong>
        </article>
      </section>

      <section className="workspace">
        <aside className="panel">
          <h2>储气组状态</h2>
          <div className="banks">
            <label>
              <span>氦气储气组 (bar)</span>
              <input
                type="number"
                min="0"
                value={banks.helium}
                onChange={(e) => setBank("helium", Number(e.target.value) || 0)}
              />
            </label>
            <label>
              <span>氧气储气组 (bar)</span>
              <input
                type="number"
                min="0"
                value={banks.oxygen}
                onChange={(e) => setBank("oxygen", Number(e.target.value) || 0)}
              />
            </label>
            <label>
              <span>空气储气组 (bar)</span>
              <input
                type="number"
                min="0"
                value={banks.air}
                onChange={(e) => setBank("air", Number(e.target.value) || 0)}
              />
            </label>
          </div>
          <p className="note">修改储气组压力后，待确认单的核算结果会自动更新。</p>

          <h2 className="rules-title">复核规则</h2>
          <ul className="rule-list">
            <li>分压顺序：氦 → 氧 → 空气顶充，残气按空气（氧 21%）计</li>
            <li>目标氧含量 &gt; {O2_CLEAN_LIMIT}% 须选用氧气专用阀门，否则不得开工</li>
            <li>储气组压力不足：保留原目标，并在单上写明原因</li>
            <li>检验过期气瓶不得开工</li>
            <li>启动后锁定气瓶与配气单；同瓶重复提交仅更新待确认单</li>
            <li>
              签收容许偏差：氧 ±{TOL_O2}%、氦 ±{TOL_HE}%
            </li>
          </ul>
        </aside>

        <section className="panel form-panel">
          <div className="heading">
            <div>
              <p>登记 / 复核</p>
              <h2>配气单登记</h2>
            </div>
            <button className="primary" onClick={handleSubmit}>
              生成 / 更新配气单
            </button>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="field-grid">
              <label>
                <span>气瓶编号</span>
                <input
                  placeholder="如 TANK-204"
                  value={form.tankId}
                  onChange={(e) => handleTankChange(e.target.value)}
                />
              </label>
              <label>
                <span>容积 (L)</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.volume}
                  onChange={(e) => setForm({ ...form, volume: e.target.value })}
                />
              </label>
              <label>
                <span>耐压值 (bar)</span>
                <input
                  type="number"
                  min="0"
                  value={form.rated}
                  onChange={(e) => setForm({ ...form, rated: e.target.value })}
                />
              </label>
              <label>
                <span>检验日期（有效期至）</span>
                <input
                  type="date"
                  value={form.inspectionDate}
                  onChange={(e) => setForm({ ...form, inspectionDate: e.target.value })}
                />
              </label>
              <label>
                <span>残压 (bar)</span>
                <input
                  type="number"
                  min="0"
                  placeholder="瓶内剩余压力"
                  value={form.residual}
                  onChange={(e) => setForm({ ...form, residual: e.target.value })}
                />
              </label>
              <label>
                <span>目标压力 (bar)</span>
                <input
                  type="number"
                  min="0"
                  value={form.target}
                  onChange={(e) => setForm({ ...form, target: e.target.value })}
                />
              </label>
              <label>
                <span>目标氧含量 (%)</span>
                <input
                  type="number"
                  min="10"
                  max="100"
                  placeholder="如 32"
                  value={form.o2}
                  onChange={(e) => setForm({ ...form, o2: e.target.value })}
                />
              </label>
              <label>
                <span>目标氦含量 (%)</span>
                <input
                  type="number"
                  min="0"
                  max="85"
                  value={form.he}
                  onChange={(e) => setForm({ ...form, he: e.target.value })}
                />
              </label>
              <label>
                <span>操作员</span>
                <input
                  placeholder="姓名 / 工号"
                  value={form.operator}
                  onChange={(e) => setForm({ ...form, operator: e.target.value })}
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.o2CleanValve}
                  onChange={(e) => setForm({ ...form, o2CleanValve: e.target.checked })}
                />
                <span>已选用氧气专用阀门（氧含量 &gt; {O2_CLEAN_LIMIT}% 必需）</span>
              </label>
            </div>
          </form>
          {tankHint && <p className="hint">{tankHint}</p>}
          {flash && (
            <div className={`flash ${flash.kind}`}>
              {flash.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}
        </section>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>充填队列</p>
            <h2>配气单（{activeOrders.length}）</h2>
          </div>
        </div>
        {activeOrders.length === 0 ? (
          <p className="empty">暂无待处理配气单，请在上方登记。</p>
        ) : (
          <div className="orders">
            {activeOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                banks={banks}
                today={today}
                onStart={handleStart}
                onComplete={handleComplete}
                onSign={handleSign}
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>签收归档</p>
            <h2>混气档案（{archivedOrders.length}）</h2>
          </div>
          <input
            className="filter-input"
            placeholder="按气瓶编号追溯，如 TANK-204"
            value={archiveFilter}
            onChange={(e) => setArchiveFilter(e.target.value)}
          />
        </div>
        {filteredArchive.length === 0 ? (
          <p className="empty">
            {archivedOrders.length === 0
              ? "暂无归档记录，签收通过后自动写入。"
              : "没有匹配该编号的档案。"}
          </p>
        ) : (
          <div className="archive-table-wrap">
            <table className="archive-table">
              <thead>
                <tr>
                  <th>单号</th>
                  <th>气瓶编号</th>
                  <th>目标配比</th>
                  <th>实测氧 / 氦</th>
                  <th>偏差</th>
                  <th>充至压力</th>
                  <th>操作员</th>
                  <th>签收时间</th>
                </tr>
              </thead>
              <tbody>
                {filteredArchive.map((o) => (
                  <tr key={o.id}>
                    <td>{o.id}</td>
                    <td>
                      <b>{o.tankId}</b>
                    </td>
                    <td>
                      O₂ {o.o2}% / He {o.he}%
                    </td>
                    <td>
                      {o.measuredO2}% / {o.measuredHe}%
                    </td>
                    <td>
                      氧 {f1(Math.abs((o.measuredO2 ?? 0) - o.o2))}% · 氦{" "}
                      {f1(Math.abs((o.measuredHe ?? 0) - o.he))}%
                    </td>
                    <td>{f1(o.target)} bar</td>
                    <td>{o.operator}</td>
                    <td>{o.archivedAt ? fmtTime(o.archivedAt) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">档案保存在浏览器本地存储，重载页面仍可追溯。</p>
      </section>
    </main>
  );
}

interface CardProps {
  order: Order;
  banks: Banks;
  today: string;
  onStart: (id: string) => void;
  onComplete: (id: string) => void;
  onSign: (id: string, measuredO2: number, measuredHe: number) => void;
}

function OrderCard({ order, banks, today, onStart, onComplete, onSign }: CardProps) {
  const [mO2, setMO2] = useState("");
  const [mHe, setMHe] = useState("");
  const [err, setErr] = useState("");

  const blockers = order.status === "pending" ? startBlockers(order, banks, today) : [];
  const issue = order.status === "pending" ? bankIssue(order.steps, banks) : null;
  const expired = order.inspectionDate < today;
  const expiringSoon = !expired && order.inspectionDate <= addDays(today, 30);

  const trySign = () => {
    const mo = Number(mO2);
    const mh = Number(mHe);
    if (mO2.trim() === "" || Number.isNaN(mo) || mHe.trim() === "" || Number.isNaN(mh)) {
      setErr("请填写实测氧含量与实测氦含量");
      return;
    }
    const dO2 = Math.abs(mo - order.o2);
    const dHe = Math.abs(mh - order.he);
    if (dO2 > TOL_O2 || dHe > TOL_HE) {
      setErr(
        `实测偏差 氧 ${f1(dO2)}% / 氦 ${f1(dHe)}%，超出容许范围（氧 ±${TOL_O2}%、氦 ±${TOL_HE}%），不能签收`
      );
      return;
    }
    onSign(order.id, mo, mh);
  };

  return (
    <article className={`order-card status-${order.status}`}>
      <header>
        <div>
          <b className="order-id">{order.id}</b>
          <span className="tank">{order.tankId}</span>
          {order.status === "filling" && <span className="lock">🔒 气瓶与配气单已锁定</span>}
        </div>
        <span className={`badge ${order.status}`}>{STATUS_TEXT[order.status]}</span>
      </header>

      <p className="meta">
        {order.volume}L · 耐压 {order.rated}bar · 残压 {f1(order.residual)}bar → 目标{" "}
        {f1(order.target)}bar · 目标 O₂ {order.o2}% / He {order.he}% ·{" "}
        {order.o2CleanValve ? "氧气专用阀门" : "普通阀门"} · 操作员 {order.operator}
      </p>
      <p className="meta">
        检验有效期至 {order.inspectionDate}{" "}
        {expired && <span className="badge danger">检验已过期</span>}
        {expiringSoon && <span className="badge warn">检验临期（30天内）</span>}
      </p>

      <table className="steps-table">
        <thead>
          <tr>
            <th>#</th>
            <th>介质</th>
            <th>起始 (bar)</th>
            <th>充至 (bar)</th>
            <th>加入 (bar)</th>
          </tr>
        </thead>
        <tbody>
          {order.steps.map((s) => (
            <tr key={s.seq}>
              <td>{s.seq}</td>
              <td>{s.gas}</td>
              <td>{f1(s.from)}</td>
              <td>{f1(s.to)}</td>
              <td>{f1(s.add)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {issue && <p className="alert warn">{issue}</p>}

      {order.status === "pending" && (
        <div className="actions">
          {blockers.length > 0 && (
            <div className="alert danger">
              <b>不得开工：</b>
              <ul>
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            className="primary"
            disabled={blockers.length > 0}
            onClick={() => onStart(order.id)}
          >
            启动充填并锁定
          </button>
        </div>
      )}

      {order.status === "filling" && (
        <div className="actions">
          <p className="note">按步骤充填完成后进入复核。启动时间：{fmtTime(order.startedAt ?? 0)}</p>
          <button className="primary" onClick={() => onComplete(order.id)}>
            充填完成，进入复核
          </button>
        </div>
      )}

      {order.status === "review" && (
        <div className="actions">
          <p className="note">
            签收前复核实测值，容许偏差：氧 ±{TOL_O2}%、氦 ±{TOL_HE}%
          </p>
          <div className="sign-row">
            <label>
              <span>实测氧含量 (%)</span>
              <input
                type="number"
                step="0.1"
                value={mO2}
                onChange={(e) => {
                  setMO2(e.target.value);
                  setErr("");
                }}
              />
            </label>
            <label>
              <span>实测氦含量 (%)</span>
              <input
                type="number"
                step="0.1"
                value={mHe}
                onChange={(e) => {
                  setMHe(e.target.value);
                  setErr("");
                }}
              />
            </label>
            <button className="primary" onClick={trySign}>
              复核签收
            </button>
          </div>
          {err && <p className="alert danger">{err}</p>}
        </div>
      )}
    </article>
  );
}

export default App;

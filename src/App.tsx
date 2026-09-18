import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import RegistrationPanel from "./components/RegistrationPanel";
import SheetQueue from "./components/SheetQueue";
import ArchivePanel from "./components/ArchivePanel";
import BankSidebar from "./components/BankSidebar";
import { buildPlan, isInspectionExpired, parseForm } from "./domain";
import { store } from "./storage";
import type {
  ArchiveRecord,
  Banks,
  DraftForm,
  MixSheet,
} from "./types";

const FILTERS = ["全部", "待开工", "充填中", "待签收", "高氧(>40%)", "Trimix"] as const;

let seq = 1;
function newId(prefix: string) {
  const t = Date.now().toString(36).toUpperCase();
  return `${prefix}-${t}-${String(seq++).padStart(2, "0")}`;
}

export default function App() {
  const [sheets, setSheets] = useState<MixSheet[]>(() => store.loadSheets());
  const [archive, setArchive] = useState<ArchiveRecord[]>(() => store.loadArchive());
  const [banks, setBanks] = useState<Banks>(() => store.loadBanks());
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("全部");
  const [toast, setToast] = useState<string>("");

  useEffect(() => store.saveSheets(sheets), [sheets]);
  useEffect(() => store.saveArchive(archive), [archive]);
  useEffect(() => store.saveBanks(banks), [banks]);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 3200);
  };

  // 登记提交：同瓶已有单 → 仅当该瓶处于待确认（OPEN）时更新原记录，绝不产生第二张单
  const handleSubmit = (form: DraftForm) => {
    const parsed = parseForm(form);
    if (!parsed.data) return;
    const input = parsed.data;
    const locked = sheets.some(
      (s) => s.input.cylinderNo === input.cylinderNo && s.stage !== "OPEN"
    );
    if (locked) {
      flash(`气瓶 ${input.cylinderNo} 已锁定（充填中/待签收），不能再开新单或修改`);
      return;
    }
    const existing = sheets.find(
      (s) => s.input.cylinderNo === input.cylinderNo && s.stage === "OPEN"
    );
    if (existing) {
      setSheets((prev) =>
        prev.map((s) => (s.id === existing.id ? { ...s, input, createdAt: Date.now() } : s))
      );
      flash(`已更新气瓶 ${input.cylinderNo} 的待确认记录（未产生第二张单）`);
    } else {
      setSheets((prev) => [
        ...prev,
        { id: newId("GM"), createdAt: Date.now(), input, stage: "OPEN" },
      ]);
      flash(`已为气瓶 ${input.cylinderNo} 生成待确认配气单`);
    }
  };

  // 开工：再次按当前气源校验，通过后冻结方案并锁定
  const handleStart = (id: string) => {
    setSheets((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const plan = buildPlan(s.input, banks);
        if (plan.blockers.length > 0 || isInspectionExpired(s.input.inspectDate) || !plan.feasible) {
          return s;
        }
        return {
          ...s,
          stage: "FILLING",
          startedAt: Date.now(),
          frozenPlan: {
            steps: plan.steps,
            effectiveO2: plan.effectiveO2,
            effectiveHe: plan.effectiveHe,
          },
        };
      })
    );
    flash("已开工：气瓶与配气单已锁定，充填步骤已冻结");
  };

  const handleFilled = (id: string) => {
    setSheets((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, stage: "PENDING", filledAt: Date.now() } : s
      )
    );
    flash("充填完成，请输入实测氧氦值进行签收复核");
  };

  const handleSign = (id: string, measuredO2: number, measuredHe: number, signer: string) => {
    const sheet = sheets.find((s) => s.id === id);
    if (!sheet || !sheet.frozenPlan) return;
    const record: ArchiveRecord = {
      id: sheet.id,
      cylinderNo: sheet.input.cylinderNo,
      createdAt: sheet.createdAt,
      startedAt: sheet.startedAt ?? Date.now(),
      signedAt: Date.now(),
      operator: sheet.input.operator,
      signer,
      input: sheet.input,
      steps: sheet.frozenPlan.steps,
      effectiveO2: sheet.frozenPlan.effectiveO2,
      effectiveHe: sheet.frozenPlan.effectiveHe,
      measuredO2,
      measuredHe,
    };
    setArchive((prev) => [record, ...prev]);
    setSheets((prev) => prev.filter((s) => s.id !== id));
    flash("复核通过，已写入混气档案");
  };

  const handleWithdraw = (id: string) => {
    setSheets((prev) => prev.filter((s) => s.id !== id));
    flash("已撤回该待确认记录");
  };

  const metrics = useMemo(() => {
    const open = sheets.filter((s) => s.stage === "OPEN").length;
    const expired = sheets.filter((s) => isInspectionExpired(s.input.inspectDate)).length;
    const high = sheets.filter((s) => s.input.targetO2 > 40).length;
    return { open, expired, high, archived: archive.length };
  }, [sheets, archive]);

  const knownCylinders = useMemo(
    () =>
      // 已锁定的气瓶禁止再次登记；OPEN 的同瓶在 RegistrationPanel 提示“将更新”
      sheets.filter((s) => s.stage !== "OPEN").map((s) => s.input.cylinderNo),
    [sheets]
  );

  return (
    <main className="app">
      <section className="hero compact">
        <p>GAS-MIX-REVIEW · 潜水供气 · Port 62010</p>
        <h1>气瓶混气复核台</h1>
        <span>
          登记耐压值、检验日期、残压、目标压力与氧氦目标后，系统按分压顺序（氦 → 氧 → 空气顶压）计算充填步骤；
          氧含量超四成须勾选氧清洁专用阀门，储气组压力不足时保留原目标并写明原因。
          开工即锁定气瓶与配气单，签收前复核实测氧氦值，通过后写入混气档案，重载页面仍可追溯。
        </span>
      </section>

      <section className="metrics">
        <article><small>待开工配气单</small><strong>{metrics.open}</strong></article>
        <article><small>检验过期阻断</small><strong className={metrics.expired ? "danger" : ""}>{metrics.expired}</strong></article>
        <article><small>高氧单（&gt;40% O₂）</small><strong>{metrics.high}</strong></article>
        <article><small>已归档签收单</small><strong>{metrics.archived}</strong></article>
      </section>

      <section className="workspace">
        <BankSidebar
          banks={banks}
          onChange={setBanks}
          sheetCount={sheets.length}
          highO2={metrics.high}
        />
        <RegistrationPanel
          banks={banks}
          knownCylinders={knownCylinders}
          onSubmit={handleSubmit}
        />
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>配气工作台</p>
            <h2>充填步骤与签收复核</h2>
          </div>
        </div>
        <div className="chips filter-chips">
          {FILTERS.map((f) => (
            <button
              key={f}
              className={filter === f ? "chip-on" : ""}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <SheetQueue
          sheets={sheets}
          banks={banks}
          filter={filter}
          onStart={handleStart}
          onFilled={handleFilled}
          onSign={handleSign}
          onWithdraw={handleWithdraw}
        />
      </section>

      <ArchivePanel archive={archive} />

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

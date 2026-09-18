import { useState } from "react";
import {
  buildPlan,
  checkMeasured,
  gasColor,
  HE_TOL,
  inspectionDaysLeft,
  isInspectionExpired,
  O2_TOL,
} from "../domain";
import type { Banks, MixSheet } from "../types";

interface Props {
  sheets: MixSheet[];
  banks: Banks;
  filter: string;
  onStart: (id: string) => void;
  onFilled: (id: string) => void;
  onSign: (id: string, measuredO2: number, measuredHe: number, signer: string) => void;
  onWithdraw: (id: string) => void;
}

const stageLabel: Record<MixSheet["stage"], string> = {
  OPEN: "待开工",
  FILLING: "充填中（已锁定）",
  PENDING: "待签收复核（已锁定）",
};

function fmtTime(ts?: number) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

export default function SheetQueue({
  sheets,
  banks,
  filter,
  onStart,
  onFilled,
  onSign,
  onWithdraw,
}: Props) {
  const [measure, setMeasure] = useState<Record<string, { o2: string; he: string; signer: string }>>(
    {}
  );

  const visible = sheets.filter((s) => {
    if (filter === "全部") return true;
    if (filter === "待开工") return s.stage === "OPEN";
    if (filter === "充填中") return s.stage === "FILLING";
    if (filter === "待签收") return s.stage === "PENDING";
    if (filter === "高氧(>40%)") return s.input.targetO2 > 40;
    if (filter === "Trimix") return s.input.targetHe > 0;
    return true;
  });

  if (visible.length === 0) {
    return <p className="muted pad">当前没有匹配的配气单。先在左侧登记气瓶。</p>;
  }

  return (
    <div className="sheets">
      {visible.map((s) => {
        const livePlan = buildPlan(s.input, banks);
        const plan = s.frozenPlan ?? {
          steps: livePlan.steps,
          effectiveO2: livePlan.effectiveO2,
          effectiveHe: livePlan.effectiveHe,
        };
        const expired = isInspectionExpired(s.input.inspectDate);
        const days = inspectionDaysLeft(s.input.inspectDate);
        const m = measure[s.id] ?? { o2: "", he: "", signer: "" };
        const mO2 = Number(m.o2);
        const mHe = Number(m.he);
        const measured =
          m.o2.trim() !== "" && m.he.trim() !== "" && !Number.isNaN(mO2) && !Number.isNaN(mHe);
        const verdict = measured
          ? checkMeasured(plan, mO2, mHe)
          : null;
        const locked = s.stage !== "OPEN";

        return (
          <article key={s.id} className={`sheet stage-${s.stage}`}>
            <header className="sheet-head">
              <div>
                <h3>{s.input.cylinderNo}</h3>
                <p className="muted">
                  单号 {s.id} · 操作员 {s.input.operator} · 登记于 {fmtTime(s.createdAt)}
                </p>
              </div>
              <span className={`stage-badge ${s.stage}`}>{stageLabel[s.stage]}</span>
            </header>

            <div className="sheet-grid">
              <div className="kv"><span>耐压值</span><b>{s.input.rating} bar</b></div>
              <div className="kv">
                <span>检验日期</span>
                <b>
                  {s.input.inspectDate}
                  {expired ? (
                    <em className="ferr"> 已过期 {-days} 天</em>
                  ) : days <= 30 ? (
                    <em className="warn"> 剩 {days} 天</em>
                  ) : (
                    <em className="muted"> 剩 {days} 天</em>
                  )}
                </b>
              </div>
              <div className="kv"><span>残压</span><b>{s.input.residualPressure} bar</b></div>
              <div className="kv"><span>目标压力</span><b>{s.input.targetPressure} bar</b></div>
              <div className="kv">
                <span>氧目标</span>
                <b className={s.input.targetO2 > 40 ? "hi-o2" : ""}>
                  O₂ {s.input.targetO2}%
                  {s.input.targetO2 > 40 && "（专用阀门）"}
                </b>
              </div>
              <div className="kv"><span>氦目标</span><b>He {s.input.targetHe}%</b></div>
              <div className="kv">
                <span>残气假设</span>
                <b>{s.input.residualKind === "air" ? "压缩空气残气" : "同配比残气"}</b>
              </div>
              <div className="kv">
                <span>专用阀门</span>
                <b>{s.input.dedicatedValve ? "已连接" : "未使用"}</b>
              </div>
            </div>

            <div className="steps-box">
              <p className="steps-title">
                {locked ? "冻结的充填步骤" : "待开工充填步骤"}
                {locked && <em className="muted">（气瓶与配气单已锁定，参数不可更改）</em>}
              </p>
              <ol className="steps compact">
                {(s.stage === "OPEN" ? livePlan.steps : s.frozenPlan?.steps ?? []).map((st, i) => (
                  <li key={st.gas + i} className="step">
                    <span className="step-no sm" style={{ background: gasColor[st.gas] }}>
                      {i + 1}
                    </span>
                    <div>
                      <strong>{st.label}</strong>
                      <p>
                        {st.from} → <b>{st.to} bar</b>，加注 {st.add} bar
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* 开工前阻断项（实时，储气组变化也会反映） */}
            {s.stage === "OPEN" && livePlan.blockers.length > 0 && (
              <div className="blockers">
                {livePlan.blockers.map((b, i) => (
                  <div key={b.code + i} className="blocker">
                    <b>不得开工 · </b>
                    {b.message}
                  </div>
                ))}
              </div>
            )}
            {s.stage === "OPEN" && expired && (
              <div className="blockers">
                <div className="blocker"><b>不得开工 · </b>气瓶检验已过有效期，请先送检。</div>
              </div>
            )}

            {s.stage === "FILLING" && (
              <div className="actions">
                <p className="muted">
                  开工时间 {fmtTime(s.startedAt)}。按步骤完成充填后，进入签收复核。
                </p>
                <button className="primary" onClick={() => onFilled(s.id)}>
                  完成充填，进入实测复核
                </button>
              </div>
            )}

            {s.stage === "PENDING" && (
              <div className="sign-box">
                <p className="steps-title">
                  签收前复核 · 理论终值 O₂ {plan.effectiveO2}% / He {plan.effectiveHe}%
                  <em className="muted">（容许偏差 ±{O2_TOL}% O₂、±{HE_TOL}% He）</em>
                </p>
                <div className="measure-row">
                  <label>
                    <span>实测氧 O₂（%）</span>
                    <input
                      type="number"
                      value={m.o2}
                      onChange={(e) =>
                        setMeasure((p) => ({ ...p, [s.id]: { ...m, o2: e.target.value } }))
                      }
                    />
                  </label>
                  <label>
                    <span>实测氦 He（%）</span>
                    <input
                      type="number"
                      value={m.he}
                      onChange={(e) =>
                        setMeasure((p) => ({ ...p, [s.id]: { ...m, he: e.target.value } }))
                      }
                    />
                  </label>
                  <label>
                    <span>签收人</span>
                    <input
                      value={m.signer}
                      placeholder="复核签收人姓名"
                      onChange={(e) =>
                        setMeasure((p) => ({ ...p, [s.id]: { ...m, signer: e.target.value } }))
                      }
                    />
                  </label>
                </div>
                {verdict && !verdict.ok && (
                  <div className="blocker">
                    {verdict.messages.map((msg) => (
                      <div key={msg}>{msg} —— 偏差超出容许范围，不能签收，请重新调和</div>
                    ))}
                  </div>
                )}
                {verdict?.ok && (
                  <p className="okline">
                    复核通过（O₂ 偏差 {verdict.o2Diff}、He 偏差 {verdict.heDiff} 个百分点），可以签收。
                  </p>
                )}
                <div className="actions">
                  <button
                    className="primary"
                    disabled={!verdict?.ok || !m.signer.trim()}
                    onClick={() => onSign(s.id, mO2, mHe, m.signer.trim())}
                  >
                    复核通过并签收归档
                  </button>
                </div>
              </div>
            )}

            {s.stage === "OPEN" && (
              <div className="actions">
                <button
                  className="primary"
                  disabled={livePlan.blockers.length > 0 || expired}
                  onClick={() => onStart(s.id)}
                >
                  开工（锁定气瓶与配气单）
                </button>
                <button onClick={() => onWithdraw(s.id)}>撤回该待确认记录</button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

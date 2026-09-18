import { useMemo, useState } from "react";
import {
  buildPlan,
  emptyForm,
  gasColor,
  inspectionDaysLeft,
  isInspectionExpired,
  parseForm,
} from "../domain";
import type { Banks, DraftForm, Plan } from "../types";

interface Props {
  banks: Banks;
  knownCylinders: string[]; // 已锁定气瓶（防止登记第二张单）
  onSubmit: (form: DraftForm) => void;
}

export default function RegistrationPanel({ banks, knownCylinders, onSubmit }: Props) {
  const [form, setForm] = useState<DraftForm>(emptyForm);
  const [submitted, setSubmitted] = useState(false);

  const set = <K extends keyof DraftForm>(key: K, value: DraftForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const parsed = useMemo(() => parseForm(form), [form]);
  const plan: Plan | null = parsed.data ? buildPlan(parsed.data, banks) : null;
  const expired = form.inspectDate ? isInspectionExpired(form.inspectDate) : false;
  const daysLeft = form.inspectDate ? inspectionDaysLeft(form.inspectDate) : null;

  const lockedNo =
    parsed.data && knownCylinders.includes(parsed.data.cylinderNo.trim())
      ? parsed.data.cylinderNo.trim()
      : null;

  const errFor = (field: keyof DraftForm) =>
    submitted ? parsed.errors.find((e) => e.field === field)?.message : undefined;

  const handleSubmit = () => {
    setSubmitted(true);
    if (!parsed.data || parsed.errors.length || lockedNo) return;
    onSubmit(form);
    setSubmitted(false);
    setForm({
      ...emptyForm,
      inspectDate: new Date().toISOString().slice(0, 10),
    });
  };

  return (
    <section className="panel form-panel">
      <div className="heading">
        <div>
          <p>配气登记</p>
          <h2>气瓶混气复核台</h2>
        </div>
        <button className="primary" onClick={handleSubmit}>
          生成待确认记录
        </button>
      </div>

      <div className="field-grid">
        <label>
          <span>气瓶编号 *</span>
          <input
            value={form.cylinderNo}
            placeholder="如 TANK-204"
            onChange={(e) => set("cylinderNo", e.target.value)}
          />
          {errFor("cylinderNo") && <em className="ferr">{errFor("cylinderNo")}</em>}
          {lockedNo && (
            <em className="ferr">
              气瓶 {lockedNo} 已锁定（充填流程中），重复提交只会更新原待确认记录，不产生第二张单
            </em>
          )}
        </label>

        <label>
          <span>操作员 *</span>
          <input
            value={form.operator}
            placeholder="登记操作员姓名"
            onChange={(e) => set("operator", e.target.value)}
          />
          {errFor("operator") && <em className="ferr">{errFor("operator")}</em>}
        </label>

        <label>
          <span>耐压值（额定工作压力 bar）</span>
          <input
            type="number"
            value={form.rating}
            onChange={(e) => set("rating", e.target.value)}
          />
          {errFor("rating") && <em className="ferr">{errFor("rating")}</em>}
        </label>

        <label>
          <span>检验日期（本次检验合格日期）</span>
          <input
            type="date"
            value={form.inspectDate}
            onChange={(e) => set("inspectDate", e.target.value)}
          />
          {errFor("inspectDate") && <em className="ferr">{errFor("inspectDate")}</em>}
          {!errFor("inspectDate") && expired && (
            <em className="ferr">检验已失效（{-daysLeft!} 天前到期），不得充填</em>
          )}
          {!errFor("inspectDate") && !expired && daysLeft !== null && daysLeft <= 30 && (
            <em className="warn">检验有效期仅剩 {daysLeft} 天，请注意复检</em>
          )}
        </label>

        <label>
          <span>残压（bar）</span>
          <input
            type="number"
            value={form.residualPressure}
            onChange={(e) => set("residualPressure", e.target.value)}
          />
          {errFor("residualPressure") && <em className="ferr">{errFor("residualPressure")}</em>}
        </label>

        <label>
          <span>目标压力（bar）</span>
          <input
            type="number"
            value={form.targetPressure}
            onChange={(e) => set("targetPressure", e.target.value)}
          />
          {errFor("targetPressure") && <em className="ferr">{errFor("targetPressure")}</em>}
        </label>

        <label>
          <span>氧目标 O₂（%）</span>
          <input
            type="number"
            value={form.targetO2}
            onChange={(e) => set("targetO2", e.target.value)}
          />
          {errFor("targetO2") && <em className="ferr">{errFor("targetO2")}</em>}
        </label>

        <label>
          <span>氦目标 He（%，空气填 0）</span>
          <input
            type="number"
            value={form.targetHe}
            onChange={(e) => set("targetHe", e.target.value)}
          />
          {errFor("targetHe") && <em className="ferr">{errFor("targetHe")}</em>}
        </label>
      </div>

      <div className="opt-row">
        <label className="checkline">
          <input
            type="checkbox"
            checked={form.dedicatedValve}
            onChange={(e) => set("dedicatedValve", e.target.checked)}
          />
          <span>
            已连接氧清洁专用阀门
            {parsed.data && parsed.data.targetO2 > 40 && !form.dedicatedValve && (
              <b className="ferr">（含氧超 40%，必勾，否则不得开工）</b>
            )}
          </span>
        </label>

        <label className="radioline">
          <span>残气成分假设：</span>
          {([
            ["mix", "同配比残气（同气续充）"],
            ["air", "压缩空气残气"],
          ] as const).map(([v, label]) => (
            <label key={v} className="radio-inline">
              <input
                type="radio"
                name="residualKind"
                checked={form.residualKind === v}
                onChange={() => set("residualKind", v)}
              />
              {label}
            </label>
          ))}
        </label>
      </div>

      {/* 实时配气方案预览 */}
      <div className="preview">
        <div className="preview-head">
          <h3>分压充填步骤预览</h3>
          {parsed.data && plan && (
            <span className="tag">
              理论终值 O₂ {plan.effectiveO2}% · He {plan.effectiveHe}%
            </span>
          )}
        </div>

        {!parsed.data && (
          <p className="muted">请补全登记信息后，系统自动按分压顺序计算充填步骤。</p>
        )}

        {expired && (
          <div className="blocker">检验日期已过有效期，按规程不得开工（请先送检）。</div>
        )}

        {lockedNo && (
          <div className="blocker">
            气瓶 {lockedNo} 已在充填流程中，提交将仅更新其待确认记录，不会新开配气单。
          </div>
        )}

        {parsed.data && plan && (
          <>
            {plan.blockers.length > 0 && (
              <div className="blockers">
                {plan.blockers.map((b, i) => (
                  <div key={b.code + i} className="blocker">
                    <b>不得开工 · </b>
                    {b.message}
                  </div>
                ))}
              </div>
            )}
            <ol className="steps">
              {plan.steps.map((s, i) => (
                <li key={s.gas + i} className="step">
                  <span className="step-no" style={{ background: gasColor[s.gas] }}>
                    {i + 1}
                  </span>
                  <div>
                    <strong>{s.label}</strong>
                    <p>
                      {s.from} → <b>{s.to} bar</b>（加注 {s.add} bar；该气目标分压{" "}
                      {s.targetPartial} bar；储气组须 ≥ {s.bankNeed} bar）
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            {plan.blockers.length === 0 && !expired && !lockedNo && (
              <p className="okline">校验通过：可生成待确认记录并开工。</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

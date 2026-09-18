// 气瓶混气复核台：核心领域逻辑（纯函数，便于核对）
import type {
  Banks,
  Blocker,
  DraftForm,
  DraftInput,
  FieldError,
  FillStep,
  Plan,
} from "./types";

export const O2_THRESHOLD = 40; // 氧含量超过四成必须使用氧清洁专用阀门
export const AIR_O2 = 20.9; // 压缩空气含氧 %
export const O2_TOL = 1.0; // 签收氧含量容许偏差（百分点）
export const HE_TOL = 1.0; // 签收氦含量容许偏差（百分点）
export const STEP = 0.1; // 加注最小刻度 bar

export const DEFAULT_BANKS: Banks = { helium: 200, oxygen: 200, air: 230 };

const round1 = (n: number) => Math.round(n * 10) / 10;

export const emptyForm: DraftForm = {
  cylinderNo: "",
  rating: "230",
  inspectDate: new Date().toISOString().slice(0, 10),
  residualPressure: "50",
  targetPressure: "200",
  targetO2: "32",
  targetHe: "0",
  dedicatedValve: false,
  residualKind: "mix",
  operator: "",
};

/** 表单校验，返回数值化的登记数据与字段错误 */
export function parseForm(form: DraftForm): {
  data?: DraftInput;
  errors: FieldError[];
} {
  const errors: FieldError[] = [];
  const num = (raw: string, field: keyof DraftForm, label: string, min = 0) => {
    const v = Number(raw);
    if (raw.trim() === "" || Number.isNaN(v)) {
      errors.push({ field, message: `${label}必须为数字` });
      return NaN;
    }
    if (v < min) {
      errors.push({ field, message: `${label}不能小于 ${min}` });
      return NaN;
    }
    return v;
  };

  const cylinderNo = form.cylinderNo.trim();
  if (!cylinderNo) errors.push({ field: "cylinderNo", message: "请填写气瓶编号" });

  const operator = form.operator.trim();
  if (!operator) errors.push({ field: "operator", message: "请填写操作员" });

  if (!form.inspectDate) {
    errors.push({ field: "inspectDate", message: "请选择检验日期" });
  }

  const rating = num(form.rating, "rating", "耐压值", 1);
  const residualPressure = num(form.residualPressure, "residualPressure", "残压");
  const targetPressure = num(form.targetPressure, "targetPressure", "目标压力", 1);
  const targetO2 = num(form.targetO2, "targetO2", "氧目标");
  const targetHe = num(form.targetHe, "targetHe", "氦目标");

  if (!Number.isNaN(targetO2) && !Number.isNaN(targetHe) && targetO2 + targetHe > 100) {
    errors.push({ field: "targetHe", message: "氧氦目标之和不能超过 100%" });
  }
  if (
    !Number.isNaN(residualPressure) &&
    !Number.isNaN(targetPressure) &&
    residualPressure > targetPressure
  ) {
    errors.push({ field: "targetPressure", message: "目标压力不能低于残压" });
  }
  if (
    !Number.isNaN(rating) &&
    !Number.isNaN(targetPressure) &&
    targetPressure > rating
  ) {
    errors.push({ field: "targetPressure", message: `目标压力超过气瓶耐压值 ${rating} bar` });
  }

  if (errors.length) return { errors };

  return {
    errors: [],
    data: {
      cylinderNo,
      rating: rating!,
      inspectDate: form.inspectDate,
      residualPressure: residualPressure!,
      targetPressure: targetPressure!,
      targetO2: targetO2!,
      targetHe: targetHe!,
      dedicatedValve: form.dedicatedValve,
      residualKind: form.residualKind,
      operator,
    },
  };
}

/**
 * 按分压法计算充填步骤。
 * 先充氦、再充氧，最后用空气顶到目标压力（重气体先入，氧气晚入更安全）。
 * 残气按“同配比残气”或“压缩空气”折算其中已有的氧/氦量。
 */
export function buildPlan(data: DraftInput, banks: Banks): Plan {
  const blockers: Blocker[] = [];
  const { residualPressure: pr, targetPressure: pt, targetO2: o2, targetHe: he } = data;

  const totalO2 = (pt * o2) / 100; // 目标含氧总量（bar·分压）
  const totalHe = (pt * he) / 100;

  // 残气中的既有量
  const resO2Pct = data.residualKind === "air" ? AIR_O2 : o2;
  const resHePct = data.residualKind === "air" ? 0 : he;
  const resO2 = (pr * resO2Pct) / 100;
  const resHe = (pr * resHePct) / 100;

  const addHe = Math.max(0, round1(totalHe - resHe));
  const addO2 = Math.max(0, round1(totalO2 - resO2));

  const afterHe = round1(pr + addHe);
  const afterO2 = round1(afterHe + addO2);
  const addAir = round1(pt - afterO2);

  // 数学可行性：充完氦氧后不能已经超过目标压力
  const feasible = afterO2 <= pt + 1e-6 && addAir >= -1e-6;

  // 安全阻断：氧含量超四成但未选专用阀门
  if (o2 > O2_THRESHOLD && !data.dedicatedValve) {
    blockers.push({
      code: "VALVE",
      message: `目标含氧 ${o2}% 超过 ${O2_THRESHOLD}%，须使用并勾选“氧清洁专用阀门”后方可开工`,
    });
  }

  const steps: FillStep[] = [];

  if (!feasible) {
    blockers.push({
      code: "INFEASIBLE",
      message:
        addAir < 0
          ? `残压 ${pr} bar 的残气折算后，仅氦/氧需求即达 ${afterO2} bar，已超过目标压力 ${pt} bar，无法在不排空的情况下配制（请先泄放残气或核对残气成分）`
          : "当前残压与目标配比无法通过分压法实现，请核对参数",
    });
    return { feasible: false, steps, blockers, effectiveO2: o2, effectiveHe: he };
  }

  if (addHe > 0) {
    steps.push({
      gas: "He",
      label: "充氦",
      targetPartial: round1(totalHe),
      add: addHe,
      from: pr,
      to: afterHe,
      bankNeed: pt,
    });
  }
  if (addO2 > 0) {
    steps.push({
      gas: "O2",
      label: "充氧",
      targetPartial: round1(totalO2),
      add: addO2,
      from: afterHe,
      to: afterO2,
      bankNeed: pt,
    });
  }
  steps.push({
    gas: "Air",
    label: addAir > 0 ? "压缩空气顶压" : "无需顶压（已达目标）",
    targetPartial: round1(pt - totalO2 - totalHe),
    add: addAir,
    from: afterO2,
    to: pt,
    bankNeed: pt,
  });

  // 储气组压力不足：保留原目标并写明原因（逐组核对，不静默降目标）
  const bankChecks: { key: keyof Banks; label: string; need: number; enabled: boolean }[] = [
    { key: "helium", label: "氦气组", need: pt, enabled: addHe > 0 },
    { key: "oxygen", label: "氧气组", need: pt, enabled: addO2 > 0 },
    { key: "air", label: "压缩空气组", need: pt, enabled: addAir > 0 },
  ];
  for (const c of bankChecks) {
    if (c.enabled && banks[c.key] < c.need) {
      blockers.push({
        code: "BANK",
        message: `${c.label}压力 ${banks[c.key]} bar，低于本单所需 ${c.need} bar；原目标 ${pt} bar / O₂ ${o2}% / He ${he}% 予以保留，请换组或补气后重试`,
      });
    }
  }

  // 取整后的理论终值（供签收对照）
  const finalO2 = round1(resO2 + addO2 + (addAir * AIR_O2) / 100);
  const finalHe = round1(resHe + addHe);
  const effectiveO2 = round1((finalO2 / pt) * 100);
  const effectiveHe = round1((finalHe / pt) * 100);

  return { feasible: true, steps, blockers, effectiveO2, effectiveHe };
}

/** 签收复核：实测值与目标值偏差是否在容许范围内 */
export function checkMeasured(
  plan: Pick<Plan, "effectiveO2" | "effectiveHe">,
  measuredO2: number,
  measuredHe: number
): { ok: boolean; o2Diff: number; heDiff: number; messages: string[] } {
  const messages: string[] = [];
  const o2Diff = round1(Math.abs(measuredO2 - plan.effectiveO2));
  const heDiff = round1(Math.abs(measuredHe - plan.effectiveHe));
  if (o2Diff > O2_TOL) {
    messages.push(
      `实测氧 ${measuredO2}% 与理论 ${plan.effectiveO2}% 偏差 ${o2Diff} 个百分点，超过容许 ±${O2_TOL}%`
    );
  }
  if (heDiff > HE_TOL) {
    messages.push(
      `实测氦 ${measuredHe}% 与理论 ${plan.effectiveHe}% 偏差 ${heDiff} 个百分点，超过容许 ±${HE_TOL}%`
    );
  }
  return { ok: messages.length === 0, o2Diff, heDiff, messages };
}

export function isInspectionExpired(date: string, today = new Date()): boolean {
  const d = new Date(date + "T00:00:00");
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return d.getTime() < t.getTime();
}

export function inspectionDaysLeft(date: string, today = new Date()): number {
  const d = new Date(date + "T00:00:00");
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

export const gasColor: Record<string, string> = {
  He: "#7c3aed",
  O2: "#0d9488",
  Air: "#075985",
};

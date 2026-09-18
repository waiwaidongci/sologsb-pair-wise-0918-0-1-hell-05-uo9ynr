export interface FillStep {
  seq: number;
  gas: "氦气" | "氧气" | "空气";
  from: number;
  to: number;
  add: number;
}

export type OrderStatus = "pending" | "filling" | "review" | "archived";

export interface Order {
  id: string;
  tankId: string;
  volume: number;
  rated: number;
  inspectionDate: string;
  residual: number;
  target: number;
  o2: number;
  he: number;
  o2CleanValve: boolean;
  operator: string;
  status: OrderStatus;
  steps: FillStep[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  measuredO2?: number;
  measuredHe?: number;
  archivedAt?: number;
}

export interface Banks {
  helium: number;
  oxygen: number;
  air: number;
}

export const AIR_FO2 = 0.21;
export const O2_CLEAN_LIMIT = 40;
export const TOL_O2 = 1.0;
export const TOL_HE = 2.0;

export interface BlendPlan {
  steps: FillStep[];
  pHe: number;
  pO2: number;
  pAir: number;
}

/**
 * 按分压法计算充填步骤：先氦、后氧、最后空气顶充。
 * 残气一律按空气（氧 21%）计。
 */
export function planBlend(
  residual: number,
  target: number,
  o2pct: number,
  hepct: number
): BlendPlan | { error: string } {
  const fo2 = o2pct / 100;
  const fhe = hepct / 100;
  const pHe = fhe * target;
  const pO2 = (target * (fo2 - AIR_FO2) + AIR_FO2 * pHe) / (1 - AIR_FO2);
  const pAir = target - residual - pHe - pO2;

  if (pO2 < -0.05) {
    return {
      error: `残气按空气（氧 21%）计，当前氦比例无法把氧含量稀释到 ${o2pct}%，请先抽空瓶内残气或调整氧氦目标`,
    };
  }
  if (pAir < -0.05) {
    return { error: "目标压力容纳不下所需氧氦分压，请提高目标压力或降低氧氦目标" };
  }

  const steps: FillStep[] = [];
  let cursor = residual;
  const push = (gas: FillStep["gas"], add: number) => {
    if (add <= 0.05) return;
    steps.push({ seq: steps.length + 1, gas, from: cursor, to: cursor + add, add });
    cursor += add;
  };
  push("氦气", pHe);
  push("氧气", Math.max(0, pO2));
  push("空气", Math.max(0, pAir));

  if (steps.length === 0) {
    return { error: "残压已与目标压力一致，无需充填" };
  }
  return { steps, pHe, pO2, pAir };
}

/** 储气组压力核算：各气种储气组压力必须不低于对应步骤的充至压力。 */
export function bankIssue(steps: FillStep[], banks: Banks): string | null {
  const problems: string[] = [];
  for (const s of steps) {
    const bank = s.gas === "氦气" ? banks.helium : s.gas === "氧气" ? banks.oxygen : banks.air;
    if (bank + 1e-9 < s.to) {
      problems.push(
        `${s.gas}储气组现压 ${bank.toFixed(0)}bar，低于该步充至压力 ${s.to.toFixed(1)}bar`
      );
    }
  }
  if (!problems.length) return null;
  return `储气组压力不足：${problems.join("；")}。已保留原目标，待储气组增压后方可开工。`;
}

/** 开工前拦截规则，返回空数组表示可以开工。 */
export function startBlockers(order: Order, banks: Banks, today: string): string[] {
  const list: string[] = [];
  if (order.inspectionDate < today) {
    list.push(`检验有效期 ${order.inspectionDate} 已过期，须重新检验后方可充填`);
  }
  if (order.o2 > O2_CLEAN_LIMIT && !order.o2CleanValve) {
    list.push(
      `目标氧含量 ${order.o2}% 超过 ${O2_CLEAN_LIMIT}%，未选用氧气专用阀门，不得开工`
    );
  }
  const issue = bankIssue(order.steps, banks);
  if (issue) list.push(issue);
  return list;
}

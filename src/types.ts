// 气瓶混气复核台：领域类型

export type ResidualKind = "mix" | "air";
// mix：残气按目标配比（同气续充）；air：残气按压缩空气 20.9% O2 处理

export type Stage = "OPEN" | "FILLING" | "PENDING";
// OPEN 待开工（可更新/撤回）；FILLING 充填中（锁定）；PENDING 待签收复核（锁定）

export type StepGas = "He" | "O2" | "Air";

/** 已解析的配气登记数据（数值均为有效数字） */
export interface DraftInput {
  cylinderNo: string; // 气瓶编号
  rating: number; // 耐压值（额定工作压力 bar）
  inspectDate: string; // 检验日期 YYYY-MM-DD
  residualPressure: number; // 残压 bar
  targetPressure: number; // 目标压力 bar
  targetO2: number; // 氧目标 %
  targetHe: number; // 氦目标 %
  dedicatedValve: boolean; // 已接氧清洁专用阀门
  residualKind: ResidualKind; // 残气成分假设
  operator: string; // 操作员
}

/** 表单原始字符串 */
export interface DraftForm {
  cylinderNo: string;
  rating: string;
  inspectDate: string;
  residualPressure: string;
  targetPressure: string;
  targetO2: string;
  targetHe: string;
  dedicatedValve: boolean;
  residualKind: ResidualKind;
  operator: string;
}

/** 储气组压力（bar） */
export interface Banks {
  helium: number;
  oxygen: number;
  air: number;
}

export interface FillStep {
  gas: StepGas;
  label: string;
  targetPartial: number; // 该气体在目标压力下的分压 bar
  add: number; // 本步加注量 bar（保留 0.1）
  from: number; // 加注前表压
  to: number; // 加注后表压
  bankNeed: number; // 本步要求储气组最低压力（= to）
}

export interface Blocker {
  code: string;
  message: string;
}

export interface Plan {
  feasible: boolean; // 混气数学上是否可行
  steps: FillStep[];
  blockers: Blocker[]; // 开工阻断项（保留原目标，写明原因）
  effectiveO2: number; // 按 0.1bar 取整后的理论终含氧 %
  effectiveHe: number; // 理论终含氦 %
}

export interface FieldError {
  field: keyof DraftForm;
  message: string;
}

export interface FrozenPlan {
  steps: FillStep[];
  effectiveO2: number;
  effectiveHe: number;
}

export interface MixSheet {
  id: string;
  createdAt: number;
  startedAt?: number;
  filledAt?: number;
  input: DraftInput;
  stage: Stage;
  frozenPlan?: FrozenPlan; // 开工时冻结，签收复核以此为准
}

export interface ArchiveRecord {
  id: string;
  cylinderNo: string;
  createdAt: number;
  startedAt: number;
  signedAt: number;
  operator: string;
  signer: string;
  input: DraftInput;
  steps: FillStep[];
  effectiveO2: number;
  effectiveHe: number;
  measuredO2: number;
  measuredHe: number;
}

import { useState } from "react";
import type { Banks } from "../types";

interface Props {
  banks: Banks;
  onChange: (b: Banks) => void;
  sheetCount: number;
  highO2: number;
}

export default function BankSidebar({ banks, onChange, sheetCount, highO2 }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Banks>(banks);

  const rows: { key: keyof Banks; label: string; color: string }[] = [
    { key: "helium", label: "氦气组 He", color: "#7c3aed" },
    { key: "oxygen", label: "氧气组 O₂", color: "#0d9488" },
    { key: "air", label: "压缩空气组", color: "#075985" },
  ];

  return (
    <aside className="panel side">
      <div className="heading">
        <div>
          <p>气源状态</p>
          <h2>储气组压力</h2>
        </div>
        <button onClick={() => { setDraft(banks); setEditing((v) => !v); }}>
          {editing ? "取消" : "设置"}
        </button>
      </div>

      {!editing ? (
        <div className="bank-list">
          {rows.map((r) => (
            <div key={r.key} className="bank-row">
              <span className="dot" style={{ background: r.color }} />
              <span className="bank-label">{r.label}</span>
              <b>{banks[r.key]}</b>
              <em>bar</em>
            </div>
          ))}
        </div>
      ) : (
        <div className="bank-edit">
          {rows.map((r) => (
            <label key={r.key}>
              <span>{r.label}（bar）</span>
              <input
                type="number"
                value={draft[r.key]}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [r.key]: Number(e.target.value) }))
                }
              />
            </label>
          ))}
          <button
            className="primary"
            onClick={() => {
              onChange(draft);
              setEditing(false);
            }}
          >
            保存气源压力
          </button>
        </div>
      )}

      <div className="side-note">
        <p>
          规则：任一在用气源压力低于配气单所需压力时，<b>保留原目标</b>并写明原因，不得自动降压。
        </p>
        <p className="muted">
          当前流程中 {sheetCount} 张单，其中含氧超 40% {highO2} 张（须专用阀门）。
        </p>
      </div>
    </aside>
  );
}

import { useMemo, useState } from "react";
import { gasColor, O2_TOL, HE_TOL } from "../domain";
import type { ArchiveRecord } from "../types";

interface Props {
  archive: ArchiveRecord[];
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

export default function ArchivePanel({ archive }: Props) {
  const [query, setQuery] = useState("");
  const [activeNo, setActiveNo] = useState<string>("");

  const list = useMemo(() => [...archive].sort((a, b) => b.signedAt - a.signedAt), [archive]);
  const history = useMemo(
    () =>
      list.filter((r) => r.cylinderNo.toUpperCase() === activeNo.trim().toUpperCase()),
    [list, activeNo]
  );
  const queried = query.trim()
    ? list.filter((r) => r.cylinderNo.toUpperCase().includes(query.trim().toUpperCase()))
    : list;

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>混气档案</p>
          <h2>已签收记录（重载页面仍可追溯）</h2>
        </div>
        <input
          className="search"
          placeholder="按气瓶编号检索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {list.length === 0 && <p className="muted">暂无已签收的混气档案。</p>}

      <div className="archive-list">
        {queried.map((r) => {
          const o2Diff = Math.round(Math.abs(r.measuredO2 - r.effectiveO2) * 10) / 10;
          const heDiff = Math.round(Math.abs(r.measuredHe - r.effectiveHe) * 10) / 10;
          return (
            <article key={r.id} className="archive-item">
              <header>
                <div>
                  <h3>{r.cylinderNo}</h3>
                  <p className="muted">
                    单号 {r.id} · 签收于 {fmtTime(r.signedAt)} · 操作员 {r.operator} · 签收人{" "}
                    {r.signer}
                  </p>
                </div>
                <button onClick={() => setActiveNo((v) => (v === r.cylinderNo ? "" : r.cylinderNo))}>
                  {activeNo === r.cylinderNo ? "收起单瓶历史" : "查该瓶历史"}
                </button>
              </header>

              <div className="sheet-grid">
                <div className="kv"><span>目标压力</span><b>{r.input.targetPressure} bar</b></div>
                <div className="kv"><span>残压</span><b>{r.input.residualPressure} bar</b></div>
                <div className="kv">
                  <span>理论 / 实测 O₂</span>
                  <b>
                    {r.effectiveO2}% / {r.measuredO2}%
                    <em className={o2Diff <= O2_TOL ? "ok-tag" : "ferr"}> 偏差 {o2Diff}</em>
                  </b>
                </div>
                <div className="kv">
                  <span>理论 / 实测 He</span>
                  <b>
                    {r.effectiveHe}% / {r.measuredHe}%
                    <em className={heDiff <= HE_TOL ? "ok-tag" : "ferr"}> 偏差 {heDiff}</em>
                  </b>
                </div>
              </div>

              <details>
                <summary>查看冻结的充填步骤</summary>
                <ol className="steps compact">
                  {r.steps.map((st, i) => (
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
              </details>

              {activeNo === r.cylinderNo && history.length > 0 && (
                <div className="history">
                  <p className="steps-title">{r.cylinderNo} 的历史充填记录（共 {history.length} 次）</p>
                  <table>
                    <thead>
                      <tr>
                        <th>签收时间</th><th>目标</th><th>压力</th><th>O₂ 理论/实测</th>
                        <th>He 理论/实测</th><th>操作员</th><th>签收人</th><th>单号</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => (
                        <tr key={h.id}>
                          <td>{fmtTime(h.signedAt)}</td>
                          <td>
                            O₂ {h.input.targetO2}% / He {h.input.targetHe}%
                          </td>
                          <td>
                            {h.input.residualPressure}→{h.input.targetPressure} bar
                          </td>
                          <td>
                            {h.effectiveO2}% / {h.measuredO2}%
                          </td>
                          <td>
                            {h.effectiveHe}% / {h.measuredHe}%
                          </td>
                          <td>{h.operator}</td>
                          <td>{h.signer}</td>
                          <td>{h.id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

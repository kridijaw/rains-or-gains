import { el, fmtDate, infoTip } from "./chart";
import { EFFECT_DAYS, type DataProgress } from "./series";
import { startOfDay } from "./time";
import { MIN_FIT_HOURS, MIN_WEEKS } from "./typical";

interface Milestone {
  label: string;
  detail: string;
  /** 0..1 */
  done: number;
}

const day = (date: string) => fmtDate(startOfDay(date));

function milestones(p: DataProgress): Milestone[] {
  const ownDays = 7 * MIN_WEEKS + 1;
  return [
    {
      label: "Usual on the % scale",
      detail: p.onScale
        ? "Done"
        : p.profile
          ? `${p.fitHours} of ${MIN_FIT_HOURS} hours overlap the FitX profile`
          : "Waiting for the FitX profile, fetched daily at 03:07 UTC",
      done: p.onScale ? 1 : p.fitHours / MIN_FIT_HOURS,
    },
    {
      label: "Usual from own data",
      detail:
        p.ownShare >= 1
          ? "Done"
          : `${Math.round(p.ownShare * 100)}% of open hours so far${p.ownCompleteFrom ? `, all from about ${day(p.ownCompleteFrom)}` : ""}`,
      done: p.ownShare >= 1 ? 1 : Math.min(0.99, p.days / ownDays),
    },
    {
      label: "Weather effect",
      detail:
        p.days >= EFFECT_DAYS
          ? `${p.comparableHours} hours compared`
          : `${p.comparableHours} hours compared${p.effectFrom ? `, worth reading from about ${day(p.effectFrom)}` : ""}`,
      done: Math.min(1, p.days / EFFECT_DAYS),
    },
  ];
}

export function renderProgress(root: HTMLElement, p: DataProgress | null): void {
  if (!p?.since) {
    root.hidden = true;
    return;
  }
  const steps = milestones(p);
  root.hidden = steps.every((s) => s.done >= 1);
  if (root.hidden) return;
  root.replaceChildren(
    el(
      "ol",
      { className: "milestones" },
      ...steps.map((s) => {
        const bar = el("span", { className: "bar" }, el("span", { className: "bar-fill" }));
        bar.style.setProperty("--done", String(Math.max(0.02, s.done)));
        return el(
          "li",
          { className: s.done >= 1 ? "done" : "" },
          el("span", { className: "milestone-head" }, el("span", { className: "milestone-label", text: s.label }), infoTip(s.detail)),
          bar,
        );
      }),
    ),
  );
}

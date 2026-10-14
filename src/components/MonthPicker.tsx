import { monthKey, monthLabel, shiftMonth } from '../lib/dates';

export default function MonthPicker({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const isCurrent = month === monthKey();
  return (
    <div className="month-picker">
      <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
        ‹
      </button>
      <span>{monthLabel(month)}</span>
      <button className="icon-btn" aria-label="Next month" disabled={isCurrent} onClick={() => setMonth(shiftMonth(month, 1))}>
        ›
      </button>
    </div>
  );
}

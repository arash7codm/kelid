import React, { useState } from 'react';
import {
  addDaysToJalali,
  formatJalaliString,
  getTodayJalali,
  parseJalaliString,
  toPersianDigits,
} from '../utils/persian';

const MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

export const JalaliDatePickerModal: React.FC<{
  initialValue?: string;
  title?: string;
  includeTime?: boolean;
  initialTime?: string;
  onSelect: (jalaliDate: string, time?: string) => void;
  onClose: () => void;
}> = ({
  initialValue,
  title = 'انتخاب تاریخ شمسی',
  includeTime = false,
  initialTime = '11:00',
  onSelect,
  onClose,
}) => {
  const today = getTodayJalali(true);
  const parsed = parseJalaliString(initialValue || today) || [1405, 7, 19];
  const [year, setYear] = useState(parsed[0]);
  const [month, setMonth] = useState(parsed[1]);
  const [day, setDay] = useState(parsed[2]);
  const [time, setTime] = useState(initialTime);

  const daysInMonth = month <= 6 ? 31 : month <= 11 ? 30 : 29;

  const handleQuickPick = (daysOffset: number) => {
    const target = addDaysToJalali(today, daysOffset, true);
    onSelect(target, time);
  };

  const handleConfirm = () => {
    const formatted = formatJalaliString(year, month, Math.min(day, daysInMonth), true);
    onSelect(formatted, time);
  };

  return (
    <div
      className="fixed inset-0 z-[140] bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="sheet-enter-up w-full max-w-sm rounded-3xl bg-[#0a1328]/95 border border-[#f1cb83]/35 p-5 shadow-2xl space-y-4 text-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#f1cb83] text-[20px]">calendar_month</span>
            <h3 className="text-[14px] font-bold text-[#dae2ff]">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-[#d1c5b4]"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Quick Presets */}
        <div className="grid grid-cols-4 gap-1.5">
          <button
            type="button"
            onClick={() => handleQuickPick(0)}
            className="py-1.5 px-2 rounded-xl bg-[#f1cb83]/15 border border-[#f1cb83]/35 text-[#f1cb83] text-[11px] font-bold cursor-pointer"
          >
            امروز
          </button>
          <button
            type="button"
            onClick={() => handleQuickPick(1)}
            className="py-1.5 px-2 rounded-xl bg-white/5 border border-white/10 text-[#dae2ff] text-[11px] font-medium hover:border-[#f1cb83]/40 cursor-pointer"
          >
            فردا
          </button>
          <button
            type="button"
            onClick={() => handleQuickPick(2)}
            className="py-1.5 px-2 rounded-xl bg-white/5 border border-white/10 text-[#dae2ff] text-[11px] font-medium hover:border-[#f1cb83]/40 cursor-pointer"
          >
            پس‌فردا
          </button>
          <button
            type="button"
            onClick={() => handleQuickPick(7)}
            className="py-1.5 px-2 rounded-xl bg-white/5 border border-white/10 text-[#dae2ff] text-[11px] font-medium hover:border-[#f1cb83]/40 cursor-pointer"
          >
            هفته بعد
          </button>
        </div>

        {/* Year & Month Selectors */}
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[10px] text-[#d1c5b4] mb-1">سال شمسی</label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-full h-10 px-2.5 rounded-xl bg-[#050b17] border border-[#f1cb83]/25 text-xs font-bold text-[#dae2ff]"
            >
              {[1404, 1405, 1406, 1407].map((y) => (
                <option key={y} value={y}>
                  {toPersianDigits(y)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-[#d1c5b4] mb-1">ماه</label>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="w-full h-10 px-2.5 rounded-xl bg-[#050b17] border border-[#f1cb83]/25 text-xs font-bold text-[#dae2ff]"
            >
              {MONTHS.map((m, idx) => (
                <option key={m} value={idx + 1}>
                  {toPersianDigits(idx + 1)} - {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Day Grid */}
        <div className="grid grid-cols-7 gap-1.5 p-2.5 rounded-2xl bg-[#050b17]/80 border border-white/10">
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDay(d)}
              className={`h-8 rounded-lg text-xs font-bold flex items-center justify-center transition-all cursor-pointer ${
                day === d
                  ? 'bg-[#f1cb83] text-[#261900] shadow-[0_0_10px_rgba(241,203,131,0.5)]'
                  : 'text-[#dae2ff] hover:bg-white/10'
              }`}
            >
              {toPersianDigits(d)}
            </button>
          ))}
        </div>

        {includeTime && (
          <div>
            <label className="block text-[10px] text-[#d1c5b4] mb-1">ساعت یادآوری</label>
            <div className="grid grid-cols-4 gap-1.5">
              {['09:30', '11:00', '16:00', '18:30'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTime(t)}
                  className={`py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    time === t
                      ? 'bg-[#f1cb83]/20 border-[#f1cb83] text-[#f1cb83]'
                      : 'bg-[#050b17] border-white/10 text-[#d1c5b4]'
                  }`}
                >
                  {toPersianDigits(t)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#d4b06a] via-[#f1cb83] to-[#ffdea3] text-[#261900] text-xs font-bold shadow-md cursor-pointer"
          >
            تایید و ثبت تاریخ ({formatJalaliString(year, month, Math.min(day, daysInMonth), true)})
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-white/10 text-xs font-medium text-[#d1c5b4] cursor-pointer"
          >
            بستن
          </button>
        </div>
      </div>
    </div>
  );
};

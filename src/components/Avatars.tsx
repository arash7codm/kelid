import React from 'react';
import { CreditTier } from '../config';

const TIER_STYLES: Record<
  CreditTier | 'neutral',
  {
    ringGradient: string;
    glow: string;
    textColor: string;
    badgeBorder: string;
    badgeBg: string;
    gradeLabel: string;
  }
> = {
  عالی: {
    ringGradient: 'linear-gradient(135deg, #10b981, #34d399)',
    glow: '0 0 16px rgba(16, 185, 129, 0.5)',
    textColor: '#34d399',
    badgeBorder: 'rgba(16, 185, 129, 0.5)',
    badgeBg: 'rgba(6, 78, 59, 0.75)',
    gradeLabel: 'تأیید درجه یک (A+)',
  },
  خوب: {
    ringGradient: 'linear-gradient(135deg, #f59e0b, #f1cb83)',
    glow: '0 0 16px rgba(245, 158, 11, 0.45)',
    textColor: '#f1cb83',
    badgeBorder: 'rgba(241, 203, 131, 0.5)',
    badgeBg: 'rgba(69, 26, 3, 0.75)',
    gradeLabel: 'تأیید اعتبار خوب (A)',
  },
  عادی: {
    ringGradient: 'linear-gradient(135deg, #06b6d4, #67e8f9)',
    glow: '0 0 16px rgba(6, 182, 212, 0.45)',
    textColor: '#38bdf8',
    badgeBorder: 'rgba(56, 189, 248, 0.5)',
    badgeBg: 'rgba(8, 47, 73, 0.75)',
    gradeLabel: 'ارزیابی استاندارد (B)',
  },
  ضعیف: {
    ringGradient: 'linear-gradient(135deg, #f43f5e, #ffb4ab)',
    glow: '0 0 16px rgba(244, 63, 94, 0.5)',
    textColor: '#fb7185',
    badgeBorder: 'rgba(244, 63, 94, 0.5)',
    badgeBg: 'rgba(76, 5, 25, 0.75)',
    gradeLabel: 'نیازمند بررسی (C)',
  },
  neutral: {
    ringGradient: 'linear-gradient(135deg, #475569, #94a3b8)',
    glow: 'none',
    textColor: '#94a3b8',
    badgeBorder: 'rgba(148, 163, 184, 0.35)',
    badgeBg: 'rgba(15, 23, 42, 0.8)',
    gradeLabel: 'انتخاب نشده',
  },
};

export function getTierMeta(tier: CreditTier | 'neutral' = 'neutral') {
  return TIER_STYLES[tier] || TIER_STYLES.neutral;
}

// Distinct Avatar Style 1: Applicant Avatar (Material Icon & Key Badge style from Stitch Image 2 & 4)
export const ApplicantAvatar: React.FC<{
  gender: 'male' | 'female';
  tier: CreditTier | 'neutral';
  size?: 'md' | 'lg';
  onClick?: () => void;
}> = ({ gender, tier, size = 'md', onClick }) => {
  const style = getTierMeta(tier);
  const dim = size === 'lg' ? 'w-16 h-16' : 'w-11 h-11';
  const iconSize = size === 'lg' ? 'text-[34px]' : 'text-[24px]';

  return (
    <div
      onClick={onClick}
      className={`relative shrink-0 ${onClick ? 'cursor-pointer group' : ''}`}
    >
      <div
        className={`${dim} rounded-2xl p-[2px] transition-all duration-300`}
        style={{ background: style.ringGradient, boxShadow: style.glow }}
      >
        <div className="w-full h-full rounded-[14px] bg-[#0a1328] flex items-center justify-center relative overflow-hidden">
          <span
            className={`material-symbols-outlined ${iconSize} select-none transition-transform group-hover:scale-110`}
            style={{ color: style.textColor, fontVariationSettings: "'FILL' 1" }}
          >
            {gender === 'female' ? 'face_3' : 'face'}
          </span>
          <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-tl-md bg-[#050914] border-t border-l border-white/20 flex items-center justify-center">
            <span className="material-symbols-outlined text-[9px] text-[#f1cb83]">key</span>
          </span>
        </div>
      </div>
      {tier !== 'neutral' && (
        <div
          className="absolute -bottom-1.5 -left-1 px-1.5 py-[1px] rounded text-[9px] font-bold shadow-sm leading-tight"
          style={{
            color: style.textColor,
            borderColor: style.badgeBorder,
            backgroundColor: style.badgeBg,
            borderWidth: 1,
          }}
        >
          {tier}
        </div>
      )}
    </div>
  );
};

// Distinct Avatar Style 2: Collaborator Vector Suit/Hijab SVG Avatar (from Stitch Image 6 & 18)
export const CollaboratorAvatar: React.FC<{
  gender: 'male' | 'female';
  tier: CreditTier | 'neutral';
  size?: 'md' | 'lg';
  onClick?: () => void;
}> = ({ gender, tier, size = 'md', onClick }) => {
  const style = getTierMeta(tier);
  const dim = size === 'lg' ? 'w-16 h-16' : 'w-13 h-13';

  return (
    <div
      onClick={onClick}
      className={`relative shrink-0 ${onClick ? 'cursor-pointer group' : ''}`}
    >
      <div
        className={`${dim} rounded-2xl p-[2px] transition-all duration-300`}
        style={{ background: style.ringGradient, boxShadow: style.glow }}
      >
        <div className="w-full h-full rounded-[14px] bg-[#0a1328] flex items-center justify-center p-1 relative overflow-hidden">
          {gender === 'female' ? (
            <svg viewBox="0 0 48 48" className="w-10 h-10" fill="none">
              <rect width="48" height="48" rx="12" fill="#0f172a" />
              <path
                d="M13 19C13 10 18 7 24 7C30 7 35 10 35 19C35 24 33 28 32 30C29 32 26 31 24 31C22 31 19 32 16 30C15 28 13 24 13 19Z"
                fill="#1e293b"
              />
              <circle cx="24" cy="19" r="6.5" fill="#fed7aa" />
              <path d="M11 41C11 32 17 29 24 29C31 29 37 32 37 41V42H11V41Z" fill="#334155" />
              <path d="M20 29L24 35L28 29Z" fill={style.textColor} />
            </svg>
          ) : (
            <svg viewBox="0 0 48 48" className="w-10 h-10" fill="none">
              <rect width="48" height="48" rx="12" fill="#0f172a" />
              <circle cx="24" cy="18" r="8.5" fill="#ffd8a8" />
              <path
                d="M15 15C15 10 19 8 24 8C29 8 33 10 33 15C33 16 31 15 28 14C25 13 22 13 20 14C17 15 15 16 15 15Z"
                fill="#1e293b"
              />
              <path d="M10 40C10 32 16 29 24 29C32 29 38 32 38 40V42H10V40Z" fill="#1e293b" />
              <path d="M19 29L24 37L29 29H19Z" fill="#ffffff" />
              <path d="M23 29L24 38L25 29H23Z" fill={style.textColor} />
            </svg>
          )}
        </div>
      </div>
      {tier !== 'neutral' && (
        <span
          className="absolute -bottom-1.5 inset-x-1 py-[1px] rounded-md text-[9px] font-bold text-center shadow-sm"
          style={{
            color: style.textColor,
            borderColor: style.badgeBorder,
            backgroundColor: style.badgeBg,
            borderWidth: 1,
          }}
        >
          {tier}
        </span>
      )}
    </div>
  );
};

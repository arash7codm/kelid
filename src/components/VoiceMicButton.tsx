import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../hooks/useAppContext';
import {
  VoiceRecordingResult,
  VoiceSessionController,
  VoiceStatusState,
} from '../services/voice';

export interface VoiceMicButtonProps {
  /** Current text value of the target field (used when append=true) */
  currentValue?: string;
  /** Called immediately as the user speaks (interim + final results) */
  onTextChange: (newText: string) => void;
  /** Optional callback when recording finishes (provides audioDataUrl + final transcript + duration) */
  onRecordingComplete?: (result: VoiceRecordingResult) => void;
  /** Whether to append to currentValue or replace it (default: false for search, true for notes/address if desired) */
  append?: boolean;
  /** Visual variant to match existing Kelid dark/gold styles */
  variant?: 'inline-icon' | 'gold-pill' | 'square-icon' | 'badge-pill';
  /** Custom label when idle (for pill variants) */
  idleLabel?: string;
  /** Custom className override */
  className?: string;
  /** Title tooltip */
  title?: string;
}

export const VoiceMicButton: React.FC<VoiceMicButtonProps> = ({
  currentValue = '',
  onTextChange,
  onRecordingComplete,
  append = false,
  variant = 'inline-icon',
  idleLabel = 'تایپ صوتی',
  className = '',
  title = 'تبدیل گفتار فارسی به متن',
}) => {
  const { askPermission, showToast } = useApp();
  const [status, setStatus] = useState<VoiceStatusState>('idle');
  const controllerRef = useRef<VoiceSessionController | null>(null);

  useEffect(() => {
    return () => {
      controllerRef.current?.cancel();
    };
  }, []);

  const handleToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (status === 'listening') {
      controllerRef.current?.stop();
      return;
    }
    if (status === 'processing') {
      return;
    }

    const allowed = await askPermission('microphone');
    if (!allowed) {
      setStatus('error');
      showToast('مجوز میکروفون رد شده است. لطفاً دسترسی میکروفون را فعال کنید.', 'error');
      return;
    }

    const baseText = append ? currentValue.trim() : '';

    const ctrl = new VoiceSessionController({
      initialText: baseText,
      onStatusChange: (nextStatus) => {
        setStatus(nextStatus);
      },
      onLiveTranscript: (liveText) => {
        onTextChange(liveText);
      },
      onSilenceTimeout: (msg) => {
        showToast(msg, 'info');
      },
      onRecordingComplete: (res) => {
        if (res.transcript) {
          onTextChange(res.transcript);
          if (res.usedFallback) {
            showToast('متن گفتار با هوش مصنوعی Gemini استخراج و درج شد', 'success');
          }
        }
        onRecordingComplete?.(res);
      },
      onError: (errMsg) => {
        setStatus('error');
        showToast(errMsg, 'error');
      },
    });

    controllerRef.current = ctrl;
    await ctrl.start();
  };

  if (variant === 'gold-pill' || variant === 'badge-pill') {
    const isListening = status === 'listening';
    const isProcessing = status === 'processing';
    const isError = status === 'error';

    return (
      <button
        type="button"
        onClick={handleToggle}
        title={title}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all cursor-pointer select-none ${
          isListening
            ? 'bg-rose-500/25 border border-rose-400 text-rose-200 shadow-[0_0_15px_rgba(244,63,94,0.4)] animate-pulse'
            : isProcessing
            ? 'bg-amber-500/25 border border-amber-400 text-amber-200'
            : isError
            ? 'bg-rose-500/15 border border-rose-400/50 text-rose-300'
            : 'bg-[#f1cb83]/15 border border-[#f1cb83]/40 text-[#f1cb83] hover:bg-[#f1cb83]/25'
        } ${className}`}
      >
        <span
          className={`material-symbols-outlined text-[16px] ${
            isProcessing ? 'animate-spin' : ''
          }`}
        >
          {isListening
            ? 'stop_circle'
            : isProcessing
            ? 'progress_activity'
            : isError
            ? 'mic_off'
            : 'mic'}
        </span>
        <span>
          {isListening
            ? 'در حال گوش دادن... (توقف)'
            : isProcessing
            ? 'در حال تبدیل صدا...'
            : isError
            ? 'تلاش مجدد صوتی'
            : idleLabel}
        </span>
      </button>
    );
  }

  if (variant === 'square-icon') {
    const isListening = status === 'listening';
    const isProcessing = status === 'processing';
    const isError = status === 'error';

    return (
      <button
        type="button"
        onClick={handleToggle}
        title={
          isListening
            ? 'در حال گوش دادن — برای توقف لمس کنید'
            : isProcessing
            ? 'در حال پردازش صدا...'
            : title
        }
        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer shrink-0 ${
          isListening
            ? 'bg-rose-500 text-white shadow-[0_0_12px_rgba(244,63,94,0.6)] animate-pulse'
            : isProcessing
            ? 'bg-amber-500/30 text-amber-200 border border-amber-400/50'
            : isError
            ? 'bg-rose-500/20 text-rose-300 border border-rose-400/40'
            : 'bg-[#f1cb83]/15 text-[#f1cb83] hover:bg-[#f1cb83]/25'
        } ${className}`}
      >
        <span
          className={`material-symbols-outlined text-[18px] ${
            isProcessing ? 'animate-spin' : ''
          }`}
        >
          {isListening
            ? 'graphic_eq'
            : isProcessing
            ? 'progress_activity'
            : isError
            ? 'mic_off'
            : 'mic'}
        </span>
      </button>
    );
  }

  // Default: 'inline-icon'
  const isListening = status === 'listening';
  const isProcessing = status === 'processing';
  const isError = status === 'error';

  return (
    <button
      type="button"
      onClick={handleToggle}
      title={
        isListening
          ? 'در حال گوش دادن — برای توقف لمس کنید'
          : isProcessing
          ? 'در حال پردازش صدا...'
          : title
      }
      className={`transition-all flex items-center justify-center cursor-pointer rounded-lg p-1 ${
        isListening
          ? 'bg-rose-500/20 text-rose-400 animate-pulse ring-1 ring-rose-400/50'
          : isProcessing
          ? 'text-amber-300'
          : isError
          ? 'text-rose-400'
          : 'text-slate-400 hover:text-[#f1cb83]'
      } ${className}`}
    >
      <span
        className={`material-symbols-outlined text-lg ${
          isProcessing ? 'animate-spin' : ''
        }`}
      >
        {isListening
          ? 'graphic_eq'
          : isProcessing
          ? 'progress_activity'
          : isError
          ? 'mic_off'
          : 'mic'}
      </span>
    </button>
  );
};

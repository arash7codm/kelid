import { GoogleGenAI } from '@google/genai';
import { getStoredGeminiApiKey } from './ai';

export type VoiceStatusState = 'idle' | 'listening' | 'paused' | 'processing' | 'error';

export interface VoiceRecordingResult {
  audioDataUrl: string;
  blob?: Blob;
  transcript: string;
  durationSec: number;
  usedFallback?: boolean;
  wasSilent?: boolean;
}

export interface VoiceSessionOptions {
  onLiveTranscript?: (text: string, isFinal: boolean) => void;
  onStatusChange?: (status: VoiceStatusState) => void;
  onWaveformLevels?: (levels: number[]) => void;
  onDurationTick?: (seconds: number) => void;
  onSilenceTimeout?: (message: string) => void;
  onRecordingComplete?: (result: VoiceRecordingResult) => void;
  onError?: (err: string) => void;
  /** Maximum recording length in seconds (default 90s) */
  maxDurationSec?: number;
  /** Initial text to prepend when appending or continuing */
  initialText?: string;
  /** Disable auto-stop on silence if user wants manual control */
  disableAutoSilenceStop?: boolean;
}

/**
 * Deduplicates cumulative interim/final segments that Android Chrome Web Speech API
 * often emits when continuous=true or interimResults=true.
 */
export function deduplicatePersianTranscript(segments: string[]): string {
  const cleaned: string[] = [];
  for (const raw of segments) {
    const seg = raw.trim();
    if (!seg) continue;
    if (cleaned.length === 0) {
      cleaned.push(seg);
      continue;
    }
    const prev = cleaned[cleaned.length - 1];
    if (seg === prev) {
      continue;
    }
    if (seg.startsWith(prev)) {
      cleaned[cleaned.length - 1] = seg;
      continue;
    }
    if (prev.endsWith(seg)) {
      continue;
    }
    let merged = false;
    const maxOverlap = Math.min(prev.length, seg.length);
    for (let len = maxOverlap; len >= 4; len--) {
      if (prev.slice(prev.length - len) === seg.slice(0, len)) {
        cleaned[cleaned.length - 1] = (prev + seg.slice(len)).trim();
        merged = true;
        break;
      }
    }
    if (!merged) {
      cleaned.push(seg);
    }
  }
  return cleaned.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Transcribes recorded audio dataURL using Gemini API when Web Speech API is unavailable or fails.
 */
export async function transcribeAudioWithGeminiFallback(
  audioDataUrl: string,
  mimeType: string = 'audio/webm'
): Promise<string> {
  const key = getStoredGeminiApiKey();
  if (!key) {
    throw new Error(
      'مرورگر شما از تبدیل مستقیم صدا به متن پشتیبانی نمی‌کند و کلید هوش مصنوعی Gemini نیز در تنظیمات ثبت نشده است.'
    );
  }

  const commaIdx = audioDataUrl.indexOf(',');
  const base64Data = commaIdx >= 0 ? audioDataUrl.slice(commaIdx + 1) : audioDataUrl;
  const cleanMime = mimeType.split(';')[0].trim() || 'audio/webm';

  const ai = new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  const response = await ai.models.generateContent({
    model: 'gemini-flash-latest',
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: cleanMime,
              data: base64Data,
            },
          },
          {
            text: 'این صدا فارسی است؛ فقط متن دقیق گفته‌شده را بدون توضیح اضافه برگردان.',
          },
        ],
      },
    ],
  });

  return (response.text || '').trim();
}

export class VoiceSessionController {
  private mediaRecorder: MediaRecorder | null = null;
  private recognition: any = null;
  private chunks: Blob[] = [];
  private activeStartTime = 0;
  private accumulatedMs = 0;
  private silenceTimer: number | null = null;
  private maxTimer: number | null = null;
  private tickTimer: number | null = null;
  private rafId: number | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private peakEnergyDetected = 0;
  private finalSegments: string[] = [];
  private interimTranscript = '';
  private isStopping = false;
  private isPausedState = false;
  private speechUnsupportedOrFailed = false;
  private speechErrorMsg: string | null = null;
  private stream: MediaStream | null = null;
  private options: VoiceSessionOptions;
  private status: VoiceStatusState = 'idle';

  constructor(options: VoiceSessionOptions) {
    this.options = options;
  }

  private setStatus(next: VoiceStatusState) {
    this.status = next;
    this.options.onStatusChange?.(next);
  }

  public getStatus(): VoiceStatusState {
    return this.status;
  }

  public getElapsedSeconds(): number {
    const currentRunMs =
      this.status === 'listening' && this.activeStartTime > 0
        ? Date.now() - this.activeStartTime
        : 0;
    return Math.max(0, Math.round((this.accumulatedMs + currentRunMs) / 1000));
  }

  private getCombinedTranscript(): string {
    const allSegments = [...this.finalSegments];
    if (this.interimTranscript.trim()) {
      allSegments.push(this.interimTranscript.trim());
    }
    const current = deduplicatePersianTranscript(allSegments);
    const prefix = (this.options.initialText || '').trim();
    if (!prefix) return current;
    if (!current) return prefix;
    if (current.startsWith(prefix)) return current;
    return `${prefix} ${current}`.trim();
  }

  private setupRealAnalyser(stream: MediaStream) {
    try {
      const AudioContextCtor =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;

      this.audioCtx = new AudioContextCtor();
      this.sourceNode = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.72;
      this.sourceNode.connect(this.analyser);

      const bufferLen = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLen);

      const updateVisualizer = () => {
        if (this.isStopping) return;
        this.rafId = window.requestAnimationFrame(updateVisualizer);

        if (document.hidden || this.isPausedState || !this.analyser) {
          return;
        }

        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLen; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLen;
        if (avg > this.peakEnergyDetected) {
          this.peakEnergyDetected = avg;
        }
        if (avg > 18) {
          this.resetSilenceTimer();
        }

        if (this.options.onWaveformLevels) {
          // Extract 12 balanced frequency bands (values normalized 6..36px or 0..100%)
          const bars: number[] = [];
          for (let b = 0; b < 12; b++) {
            const idx = Math.min(bufferLen - 1, Math.floor((b / 12) * (bufferLen * 0.75)) + 1);
            const val = dataArray[idx] || 0;
            // Scale to 12..100
            const scaled = Math.max(12, Math.min(100, Math.round((val / 255) * 95 + 12)));
            bars.push(scaled);
          }
          this.options.onWaveformLevels(bars);
        }
      };

      this.rafId = window.requestAnimationFrame(updateVisualizer);
    } catch {
      // Fallback if Web Audio API fails on a restricted device
    }
  }

  async start(): Promise<boolean> {
    try {
      this.isStopping = false;
      this.isPausedState = false;
      this.chunks = [];
      this.finalSegments = [];
      this.interimTranscript = '';
      this.accumulatedMs = 0;
      this.peakEnergyDetected = 0;
      this.speechUnsupportedOrFailed = false;
      this.speechErrorMsg = null;

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.setStatus('error');
        this.options.onError?.('مرورگر شما از دسترسی به میکروفون پشتیبانی نمی‌کند.');
        return false;
      }

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.activeStartTime = Date.now();

      // Connect real Web Audio API AnalyserNode for genuine live waveform
      this.setupRealAnalyser(this.stream);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';

      this.mediaRecorder = mimeType
        ? new MediaRecorder(this.stream, { mimeType })
        : new MediaRecorder(this.stream);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.chunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.finalizeRecording();
      };

      this.mediaRecorder.start(250);
      this.setStatus('listening');

      // Start Web Speech API (fa-IR) with interimResults for real-time live text
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition && navigator.onLine) {
        try {
          this.recognition = new SpeechRecognition();
          this.recognition.lang = 'fa-IR';
          const isAndroid = /Android/i.test(navigator.userAgent);
          this.recognition.continuous = !isAndroid;
          this.recognition.interimResults = true;
          this.recognition.maxAlternatives = 1;

          this.recognition.onresult = (event: any) => {
            this.resetSilenceTimer();
            const newFinals: string[] = [];
            let latestInterim = '';

            for (let i = 0; i < event.results.length; i++) {
              const res = event.results[i];
              const txt = (res[0]?.transcript || '').trim();
              if (!txt) continue;
              if (res.isFinal) {
                newFinals.push(txt);
              } else {
                latestInterim = txt;
              }
            }

            if (isAndroid) {
              const currentFinal = deduplicatePersianTranscript(newFinals);
              this.interimTranscript = currentFinal
                ? latestInterim
                  ? `${currentFinal} ${latestInterim}`
                  : currentFinal
                : latestInterim;
            } else {
              this.finalSegments = newFinals;
              this.interimTranscript = latestInterim;
            }

            const combined = this.getCombinedTranscript();
            this.options.onLiveTranscript?.(
              combined,
              Boolean(newFinals.length > 0 && !latestInterim)
            );
          };

          this.recognition.onerror = (event: any) => {
            const errCode = event?.error || '';
            if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
              this.speechErrorMsg =
                'مجوز میکروفون رد شده است. لطفاً دسترسی میکروفون را در مرورگر فعال کنید.';
              this.speechUnsupportedOrFailed = true;
              this.stop();
            } else if (errCode === 'network') {
              this.speechUnsupportedOrFailed = true;
            } else if (errCode === 'no-speech' || errCode === 'aborted') {
              // handled gracefully
            } else {
              this.speechUnsupportedOrFailed = true;
            }
          };

          this.recognition.onend = () => {
            if (isAndroid && this.interimTranscript.trim()) {
              this.finalSegments.push(this.interimTranscript.trim());
              this.interimTranscript = '';
            }
            if (
              !this.isStopping &&
              !this.isPausedState &&
              !this.speechUnsupportedOrFailed &&
              this.recognition
            ) {
              try {
                this.recognition.start();
              } catch {
                // ignore restart error
              }
            }
          };

          this.recognition.start();
        } catch {
          this.speechUnsupportedOrFailed = true;
        }
      } else {
        this.speechUnsupportedOrFailed = true;
      }

      this.resetSilenceTimer();
      const maxSec = this.options.maxDurationSec || 90;
      this.maxTimer = window.setTimeout(() => {
        this.stop();
      }, maxSec * 1000);

      this.tickTimer = window.setInterval(() => {
        if (!this.isPausedState) {
          this.options.onDurationTick?.(this.getElapsedSeconds());
        }
      }, 250);

      return true;
    } catch (err: any) {
      this.setStatus('error');
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        this.options.onError?.(
          'مجوز دسترسی به میکروفون رد شده است. لطفاً از تنظیمات مرورگر مجوز میکروفون را فعال کنید.'
        );
      } else if (name === 'NotFoundError') {
        this.options.onError?.('هیچ میکروفونی روی دستگاه شما شناسایی نشد.');
      } else {
        this.options.onError?.('امکان دسترسی به میکروفون وجود ندارد.');
      }
      return false;
    }
  }

  public pause() {
    if (this.status !== 'listening' || this.isPausedState) return;
    this.isPausedState = true;
    if (this.activeStartTime > 0) {
      this.accumulatedMs += Date.now() - this.activeStartTime;
      this.activeStartTime = 0;
    }
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      try {
        this.mediaRecorder.pause();
      } catch {
        // ignore
      }
    }
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
    }
    this.setStatus('paused');
  }

  public resume() {
    if (this.status !== 'paused' || !this.isPausedState) return;
    this.isPausedState = false;
    this.activeStartTime = Date.now();
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      try {
        this.mediaRecorder.resume();
      } catch {
        // ignore
      }
    }
    if (this.recognition && !this.speechUnsupportedOrFailed) {
      try {
        this.recognition.start();
      } catch {
        // ignore
      }
    }
    this.resetSilenceTimer();
    this.setStatus('listening');
  }

  private resetSilenceTimer() {
    if (this.options.disableAutoSilenceStop) return;
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
    }
    // 9 seconds of silence auto-stops
    this.silenceTimer = window.setTimeout(() => {
      if (this.isPausedState) return;
      const currentText = deduplicatePersianTranscript([
        ...this.finalSegments,
        this.interimTranscript,
      ]);
      if (!currentText && this.peakEnergyDetected < 12 && !this.speechUnsupportedOrFailed) {
        this.options.onSilenceTimeout?.(
          'صدایی دریافت نشد؛ لطفاً میکروفون را بررسی کرده یا دوباره صحبت کنید.'
        );
      }
      this.stop();
    }, 9000);
  }

  stop() {
    if (this.isStopping) return;
    this.isStopping = true;

    if (this.activeStartTime > 0) {
      this.accumulatedMs += Date.now() - this.activeStartTime;
      this.activeStartTime = 0;
    }

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
      this.recognition = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        this.finalizeRecording();
      }
    } else {
      this.finalizeRecording();
    }
  }

  cancel() {
    this.isStopping = true;
    this.isPausedState = false;
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // ignore
      }
      this.recognition = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // ignore
      }
    }
    this.cleanupAudioAndStream();
    this.setStatus('idle');
  }

  private cleanupAudioAndStream() {
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // ignore
      }
      this.sourceNode = null;
    }
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        // ignore
      }
      this.analyser = null;
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try {
        this.audioCtx.close();
      } catch {
        // ignore
      }
      this.audioCtx = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }

  private finalizeRecording() {
    this.cleanupAudioAndStream();
    const durationSec = Math.max(1, Math.round(this.accumulatedMs / 1000));
    const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
    const blob = new Blob(this.chunks, { type: mimeType });
    const wasSilent = this.peakEnergyDetected > 0 && this.peakEnergyDetected < 8 && durationSec < 2;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      let finalTranscript = this.getCombinedTranscript();
      let usedFallback = false;

      const rawSpeechOnly = deduplicatePersianTranscript([
        ...this.finalSegments,
        this.interimTranscript,
      ]);

      if (!rawSpeechOnly && blob.size > 500 && !wasSilent) {
        const geminiKey = getStoredGeminiApiKey();
        if (geminiKey && navigator.onLine) {
          this.setStatus('processing');
          try {
            const fallbackText = await transcribeAudioWithGeminiFallback(dataUrl, mimeType);
            if (fallbackText) {
              usedFallback = true;
              const prefix = (this.options.initialText || '').trim();
              finalTranscript = prefix ? `${prefix} ${fallbackText}`.trim() : fallbackText;
              this.options.onLiveTranscript?.(finalTranscript, true);
            }
          } catch {
            // Will allow caller's multimodal extraction or manual input to proceed
          }
        }
      }

      this.setStatus('idle');
      this.options.onRecordingComplete?.({
        audioDataUrl: dataUrl,
        blob,
        transcript: finalTranscript,
        durationSec,
        usedFallback,
        wasSilent,
      });
    };
    reader.readAsDataURL(blob);
  }
}

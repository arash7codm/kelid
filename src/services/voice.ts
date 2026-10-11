import { aiService } from './ai';

export interface VoiceSessionCallbacks {
  onLiveTranscript?: (text: string) => void;
  onWaveformLevels?: (levels: number[]) => void;
  onDurationTick?: (seconds: number) => void;
  onSilenceTimeout?: (message: string) => void;
  onRecordingComplete?: (result: { blob: Blob | null; transcript: string; durationSec: number }) => void;
  onError?: (errorMsg: string) => void;
}

export class VoiceSessionController {
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private recognition: any = null;
  private chunks: Blob[] = [];
  private isPaused = false;
  private isRunning = false;
  private hasSpoken = false;
  private lastSoundTimestamp = 0;
  private startTimestamp = 0;
  private durationSeconds = 0;
  private liveTranscript = '';
  private tickTimer: number | null = null;
  private waveTimer: number | null = null;
  private callbacks: VoiceSessionCallbacks;

  // Silence Rule Constants (4.5 seconds initial & post-speech silence)
  private readonly INITIAL_SILENCE_MS = 4500;
  private readonly POST_SPEECH_SILENCE_MS = 4500;

  constructor(callbacks: VoiceSessionCallbacks) {
    this.callbacks = callbacks;
  }

  public async start(): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.callbacks.onError?.('دسترسی به میکروفون مسدود است. لطفاً از تنظیمات مرورگر مجوز میکروفون را فعال کنید.');
      return false;
    }

    this.chunks = [];
    this.hasSpoken = false;
    this.isPaused = false;
    this.isRunning = true;
    this.durationSeconds = 0;
    this.liveTranscript = '';
    const now = Date.now();
    this.startTimestamp = now;
    this.lastSoundTimestamp = now;

    // 1. Setup MediaRecorder
    try {
      this.mediaRecorder = new MediaRecorder(this.stream);
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.chunks.push(e.data);
        }
      };
      this.mediaRecorder.start(250);
    } catch {
      // Fallback if MediaRecorder fails
    }

    // 2. Setup AudioContext Analyser for real waveform & silence detection
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 64;
      source.connect(this.analyser);
    } catch {
      // Ignore audio context failure
    }

    // 3. Setup Live Web Speech API if available
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRec) {
      try {
        this.recognition = new SpeechRec();
        this.recognition.lang = 'fa-IR';
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.onresult = (event: any) => {
          let combined = '';
          for (let i = 0; i < event.results.length; i++) {
            combined += event.results[i][0].transcript + ' ';
          }
          const clean = combined.trim();
          if (clean) {
            this.hasSpoken = true;
            this.lastSoundTimestamp = Date.now();
            this.liveTranscript = clean;
            this.callbacks.onLiveTranscript?.(clean);
          }
        };
        this.recognition.start();
      } catch {
        // Ignore Web Speech error
      }
    }

    // 4. Start Timers
    this.tickTimer = window.setInterval(() => {
      if (!this.isRunning || this.isPaused) return;
      this.durationSeconds++;
      this.callbacks.onDurationTick?.(this.durationSeconds);

      const elapsedSinceSound = Date.now() - this.lastSoundTimestamp;
      if (!this.hasSpoken && elapsedSinceSound >= this.INITIAL_SILENCE_MS) {
        // 4.5s initial silence -> close voice mode, show «صدایی شنیده نشد», discard empty recording
        this.cleanup();
        this.callbacks.onSilenceTimeout?.('صدایی شنیده نشد');
      } else if (this.hasSpoken && elapsedSinceSound >= this.POST_SPEECH_SILENCE_MS) {
        // 4.5s silence after speech -> auto stop and finalize
        this.stop();
      }
    }, 1000);

    this.waveTimer = window.setInterval(() => {
      if (!this.isRunning || this.isPaused || !this.analyser) return;
      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      const bars: number[] = [];
      for (let i = 0; i < 12; i++) {
        const val = dataArray[i] || 0;
        sum += val;
        bars.push(Math.max(6, Math.min(34, Math.round((val / 255) * 34))));
      }
      const avg = sum / 12;
      if (avg > 22) {
        this.hasSpoken = true;
        this.lastSoundTimestamp = Date.now();
      }
      this.callbacks.onWaveformLevels?.(bars);
    }, 100);

    return true;
  }

  public pause() {
    if (!this.isRunning || this.isPaused) return;
    this.isPaused = true;
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
    }
  }

  public resume() {
    if (!this.isRunning || !this.isPaused) return;
    this.isPaused = false;
    this.lastSoundTimestamp = Date.now();
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    const duration = this.durationSeconds;
    const hadSpeech = this.hasSpoken || this.liveTranscript.trim().length > 0;

    const blob = await new Promise<Blob | null>((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        resolve(this.chunks.length > 0 ? new Blob(this.chunks, { type: 'audio/webm' }) : null);
        return;
      }
      this.mediaRecorder.onstop = () => {
        resolve(this.chunks.length > 0 ? new Blob(this.chunks, { type: 'audio/webm' }) : null);
      };
      try {
        this.mediaRecorder.stop();
      } catch {
        resolve(null);
      }
    });

    this.cleanup();

    if (!hadSpeech && (!blob || blob.size < 1000)) {
      this.callbacks.onSilenceTimeout?.('صدایی شنیده نشد');
      return;
    }

    let finalTranscript = this.liveTranscript.trim();
    if (!finalTranscript && blob && blob.size > 0) {
      try {
        finalTranscript = await aiService.transcribeAudio(blob);
      } catch {
        // Fallback if offline
      }
    }

    this.callbacks.onRecordingComplete?.({
      blob,
      transcript: finalTranscript,
      durationSec: Math.max(1, duration),
    });
  }

  public cancel() {
    this.cleanup();
  }

  private cleanup() {
    this.isRunning = false;
    if (this.tickTimer) window.clearInterval(this.tickTimer);
    if (this.waveTimer) window.clearInterval(this.waveTimer);
    this.tickTimer = null;
    this.waveTimer = null;

    try {
      this.recognition?.stop();
    } catch {
      // ignore
    }
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
    } catch {
      // ignore
    }
    try {
      this.stream?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    try {
      this.audioContext?.close();
    } catch {
      // ignore
    }
  }
}

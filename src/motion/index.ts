// Shared Motion System & Living Glass Scheduler (No external animation libraries)

export const MOTION_TOKENS = {
  durations: {
    fast: 150,
    base: 250,
    slow: 350,
  },
  easing: {
    enter: 'cubic-bezier(0.22, 1, 0.36, 1)',
    exit: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
} as const;

export function isLowEndOrReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return true;
  }
  const nav = window.navigator as any;
  if (nav.deviceMemory && nav.deviceMemory <= 2) return true;
  if (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2) return true;
  return false;
}

export function runWithViewTransition(callback: () => void) {
  if (typeof document !== 'undefined' && 'startViewTransition' in document && !isLowEndOrReducedMotion()) {
    try {
      (document as any).startViewTransition(() => {
        callback();
      });
      return;
    } catch {
      // Fallback
    }
  }
  callback();
}

// Single Shared Living Glass Sheen Scheduler
class LivingGlassScheduler {
  private observer: IntersectionObserver | null = null;
  private visiblePanels: Set<HTMLElement> = new Set();
  private lastSwept: WeakSet<HTMLElement> = new WeakSet();
  private lastPickedIds: HTMLElement[] = [];
  private timerId: number | null = null;
  private isScrollingFast = false;
  private scrollTimeout: number | null = null;
  private isModalOpen = false;
  private activeSweepsCount = 0;

  public start() {
    if (typeof window === 'undefined' || isLowEndOrReducedMotion()) {
      document.documentElement.classList.add('reduced-glass-mode');
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          if (entry.isIntersecting) {
            this.visiblePanels.add(el);
          } else {
            this.visiblePanels.delete(el);
          }
        }
      },
      { threshold: 0.25 }
    );

    this.scanPanels();

    window.addEventListener('scroll', this.handleScroll, { passive: true });
    document.addEventListener('visibilitychange', this.handleVisibility);

    this.scheduleNext();
  }

  public scanPanels() {
    if (!this.observer) return;
    const panels = document.querySelectorAll<HTMLElement>('.crystal-glass, .glass-card, .living-glass-panel');
    panels.forEach((p) => this.observer?.observe(p));
  }

  public setModalOpen(open: boolean) {
    this.isModalOpen = open;
  }

  private handleScroll = () => {
    this.isScrollingFast = true;
    if (this.scrollTimeout) window.clearTimeout(this.scrollTimeout);
    this.scrollTimeout = window.setTimeout(() => {
      this.isScrollingFast = false;
    }, 200);
  };

  private handleVisibility = () => {
    if (document.hidden) {
      if (this.timerId) window.clearTimeout(this.timerId);
      this.timerId = null;
    } else {
      this.scheduleNext();
    }
  };

  private scheduleNext() {
    if (this.timerId) window.clearTimeout(this.timerId);
    const delay = 3000 + Math.random() * 4000; // 3-7 seconds random
    this.timerId = window.setTimeout(() => {
      this.triggerSweep();
      this.scheduleNext();
    }, delay);
  }

  private triggerSweep() {
    if (document.hidden || this.isScrollingFast || this.isModalOpen || isLowEndOrReducedMotion()) {
      return;
    }
    this.scanPanels();
    const candidates = Array.from(this.visiblePanels).filter(
      (el) => !this.lastPickedIds.includes(el) && !el.classList.contains('glass-sweep-active')
    );
    if (candidates.length === 0) {
      this.lastPickedIds = [];
      return;
    }

    const countToPick = Math.min(candidates.length, Math.random() > 0.5 ? 2 : 1, 2 - this.activeSweepsCount);
    if (countToPick <= 0) return;

    const picked: HTMLElement[] = [];
    const pool = [...candidates];
    for (let i = 0; i < countToPick; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      const chosen = pool.splice(idx, 1)[0];
      if (chosen) picked.push(chosen);
    }

    this.lastPickedIds = picked;

    picked.forEach((panel) => {
      this.activeSweepsCount++;
      const durationMs = Math.round(1200 + Math.random() * 600); // 1.2s - 1.8s
      panel.style.setProperty('--sweep-duration', `${durationMs}ms`);
      panel.classList.add('glass-sweep-active');
      window.setTimeout(() => {
        panel.classList.remove('glass-sweep-active');
        this.activeSweepsCount = Math.max(0, this.activeSweepsCount - 1);
      }, durationMs + 50);
    });
  }

  public stop() {
    if (this.timerId) window.clearTimeout(this.timerId);
    this.observer?.disconnect();
    window.removeEventListener('scroll', this.handleScroll);
    document.removeEventListener('visibilitychange', this.handleVisibility);
  }
}

export const livingGlassScheduler = new LivingGlassScheduler();

const savedListScrollPositions = new Map<string, number>();
let returningToListFlag = false;

export function getCurrentScrollTop(): number {
  if (typeof window === 'undefined') return 0;
  return (
    window.scrollY ||
    window.pageYOffset ||
    document.documentElement.scrollTop ||
    document.body.scrollTop ||
    0
  );
}

export function saveListScrollPosition(path: string, y?: number): void {
  if (typeof window === 'undefined') return;
  const scrollY = typeof y === 'number' ? y : getCurrentScrollTop();
  savedListScrollPositions.set(path, scrollY);
}

export function getSavedListScrollPosition(path: string): number {
  return savedListScrollPositions.get(path) ?? 0;
}

export function clearSavedListScrolls(): void {
  savedListScrollPositions.clear();
  returningToListFlag = false;
}

export function markReturningToList(): void {
  returningToListFlag = true;
}

export function consumeReturningToList(): boolean {
  const val = returningToListFlag;
  returningToListFlag = false;
  return val;
}

export function resetAllScrollTargets(top = 0): void {
  if (typeof window === 'undefined') return;
  window.scrollTo({ top, left: 0, behavior: 'instant' as ScrollBehavior });
  document.documentElement.scrollTop = top;
  document.body.scrollTop = top;
  if (top === 0) {
    const containers = document.querySelectorAll<HTMLElement>(
      '#root, main, [data-scroll-container="true"]'
    );
    containers.forEach((el) => {
      if (el.scrollTop > 0) {
        el.scrollTop = 0;
      }
    });
  }
}


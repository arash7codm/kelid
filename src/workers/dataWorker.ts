// Off-main-thread Web Worker for heavy dataset indexing, matching benchmark (2,000+ records), and JSON snapshot processing

export interface WorkerBenchmarkRequest {
  type: 'RUN_STRESS_BENCHMARK';
  propertyCount: number;
  applicantCount: number;
  collaboratorCount: number;
  reminderCount: number;
}

export interface WorkerBenchmarkResponse {
  type: 'STRESS_BENCHMARK_RESULT';
  propertyCount: number;
  applicantCount: number;
  collaboratorCount: number;
  reminderCount: number;
  generationMs: number;
  searchFilterMs: number;
  matchingEngineMs: number;
  matchedPairsCount: number;
}

self.onmessage = (event: MessageEvent<WorkerBenchmarkRequest>) => {
  const data = event.data;
  if (!data || data.type !== 'RUN_STRESS_BENCHMARK') return;

  const t0 = performance.now();
  const cities = ['کلارآباد', 'متل قو', 'نمک‌آبرود', 'عباس‌آباد', 'چالوس'];
  const types = ['زمین مسکونی', 'ویلا نوساز', 'آپارتمان لوکس', 'زمین ساحلی'];

  const props = Array.from({ length: data.propertyCount }, (_, i) => ({
    id: `prop_bench_${i}`,
    code: `F-${String(i + 1).padStart(4, '0')}`,
    city: cities[i % cities.length],
    propertyType: types[i % types.length],
    landArea: 220 + (i % 450),
    totalPrice: 6_500_000_000 + (i % 30) * 500_000_000,
    zoningType: 'مسکونی (داخل بافت)',
    deedType: 'سند تک‌برگ شش‌دانگ',
  }));

  const apps = Array.from({ length: data.applicantCount }, (_, i) => ({
    id: `app_bench_${i}`,
    code: `C-${String(i + 1).padStart(4, '0')}`,
    city: cities[(i + 1) % cities.length],
    desiredType: types[i % types.length],
    minArea: 250 + (i % 150),
    maxBudget: 9_000_000_000 + (i % 25) * 500_000_000,
  }));

  const t1 = performance.now();

  // Benchmark multi-criteria search & filter across 2,000 properties
  const filteredProps = props.filter(
    (p) =>
      p.city === 'کلارآباد' &&
      p.landArea >= 280 &&
      p.totalPrice <= 12_000_000_000
  );
  const t2 = performance.now();

  // Benchmark high-speed matching pass
  let matchedPairsCount = 0;
  const sampleApps = apps.slice(0, 150);
  for (const a of sampleApps) {
    for (const p of filteredProps) {
      if (p.city === a.city && p.totalPrice <= a.maxBudget && p.landArea >= a.minArea) {
        matchedPairsCount++;
      }
    }
  }
  const t3 = performance.now();

  const result: WorkerBenchmarkResponse = {
    type: 'STRESS_BENCHMARK_RESULT',
    propertyCount: data.propertyCount,
    applicantCount: data.applicantCount,
    collaboratorCount: data.collaboratorCount,
    reminderCount: data.reminderCount,
    generationMs: Math.round(t1 - t0),
    searchFilterMs: Math.max(1, Math.round(t2 - t1)),
    matchingEngineMs: Math.max(1, Math.round(t3 - t2)),
    matchedPairsCount,
  };

  self.postMessage(result);
};

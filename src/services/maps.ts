import { toEnglishDigits } from '../utils/persian';

export interface MapAppOption {
  id: string;
  name: string;
  subtitle: string;
  icon: string;
  url: string;
}

export function getMapAppOptions(lat: number, lng: number, label = 'موقعیت ملک'): MapAppOption[] {
  const cleanLat = Number(lat).toFixed(6);
  const cleanLng = Number(lng).toFixed(6);
  const encodedLabel = encodeURIComponent(label);
  const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

  const options: MapAppOption[] = [
    {
      id: 'google_maps',
      name: 'Google Maps (گوگل مپ)',
      subtitle: 'مسیریابی ماهواره‌ای و ترافیک زنده',
      icon: 'map',
      url: `https://www.google.com/maps/dir/?api=1&destination=${cleanLat},${cleanLng}`,
    },
    {
      id: 'neshan',
      name: 'نشان (Neshan)',
      subtitle: 'نقشه و مسیریاب بومی شمال کشور',
      icon: 'explore',
      url: `https://nshn.ir/?lat=${cleanLat}&lng=${cleanLng}`,
    },
    {
      id: 'balad',
      name: 'بلد (Balad)',
      subtitle: 'مسیریاب شهری و جاده‌ای ایران',
      icon: 'near_me',
      url: `https://balad.ir/location?latitude=${cleanLat}&longitude=${cleanLng}&zoom=16`,
    },
    {
      id: 'waze',
      name: 'Waze (ویز)',
      subtitle: 'مسیریابی سریع جاده‌ای',
      icon: 'directions_car',
      url: `https://waze.com/ul?ll=${cleanLat},${cleanLng}&navigate=yes`,
    },
  ];

  if (isIOS) {
    options.push({
      id: 'apple_maps',
      name: 'Apple Maps (اپل مپ)',
      subtitle: 'نقشه پیش‌فرض آیفون و آیپد',
      icon: 'navigation',
      url: `http://maps.apple.com/?ll=${cleanLat},${cleanLng}&q=${encodedLabel}`,
    });
  }

  options.push({
    id: 'geo_default',
    name: 'برنامه نقشه پیش‌فرض گوشی',
    subtitle: `مختصات دقیق: ${cleanLat}, ${cleanLng}`,
    icon: 'pin_drop',
    url: `geo:${cleanLat},${cleanLng}?q=${cleanLat},${cleanLng}(${encodedLabel})`,
  });

  return options;
}

export function triggerPhoneCall(
  phone: string | undefined | null,
  onMissingNumber?: () => void
): boolean {
  const clean = toEnglishDigits(phone || '').replace(/[^\d+]/g, '');
  if (!clean || clean.length < 8) {
    onMissingNumber?.();
    return false;
  }
  window.location.href = `tel:${clean}`;
  return true;
}

export function triggerSms(
  phone: string | undefined | null,
  prefilledBody: string,
  onMissingNumber?: () => void
): boolean {
  const clean = toEnglishDigits(phone || '').replace(/[^\d+]/g, '');
  if (!clean || clean.length < 8) {
    onMissingNumber?.();
    return false;
  }
  const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const sep = isIOS ? '&' : '?';
  window.location.href = `sms:${clean}${sep}body=${encodeURIComponent(prefilledBody)}`;
  return true;
}
